import { useState } from "react";
import {
  Button,
  Label,
  Slider,
  Switch,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components";
import {
  ChevronDownIcon,
  RotateCcwIcon,
  ChevronUpIcon,
} from "lucide-react";
import { VadConfig } from "@/hooks/useSystemAudio";
import { cn } from "@/lib/utils";
import { SessionDocuments } from "./SessionDocuments";
import type { SystemPrompt } from "@/types";

// Sensitivity presets for simpler UX
const SENSITIVITY_PRESETS = {
  noisy: {
    sensitivity_rms: 0.02,
    peak_threshold: 0.065,
    noise_gate_threshold: 0.006,
    min_speech_chunks: 26,
    silence_chunks: 60,
    label: "Noisy Room",
    description: "Rejects more clicks, keyboard noise, and background sound",
  },
  balanced: {
    sensitivity_rms: 0.014,
    peak_threshold: 0.05,
    noise_gate_threshold: 0.004,
    min_speech_chunks: 18,
    silence_chunks: 55,
    label: "Balanced",
    description: "Recommended default for normal conversations",
  },
  quiet: {
    sensitivity_rms: 0.009,
    peak_threshold: 0.035,
    noise_gate_threshold: 0.0025,
    min_speech_chunks: 12,
    silence_chunks: 50,
    label: "Quiet Speaker",
    description: "More sensitive for soft or distant speech",
  },
} as const;

type SensitivityPreset = keyof typeof SENSITIVITY_PRESETS;

interface SettingsPanelProps {
  // VAD Config
  vadConfig: VadConfig;
  onUpdateVadConfig: (config: VadConfig) => void;
  // Context settings
  useSystemPrompt: boolean;
  setUseSystemPrompt: (value: boolean) => void;
  // Saved system prompts (from the System Prompts page)
  savedPrompts?: SystemPrompt[];
  selectedPromptId?: number | null;
  onSelectPrompt?: (prompt: SystemPrompt) => void;
}

export const SettingsPanel = ({
  vadConfig,
  onUpdateVadConfig,
  useSystemPrompt,
  setUseSystemPrompt,
  savedPrompts = [],
  selectedPromptId = null,
  onSelectPrompt,
}: SettingsPanelProps) => {
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Determine current sensitivity preset based on values
  const getCurrentPreset = (): SensitivityPreset | "custom" => {
    for (const [key, preset] of Object.entries(SENSITIVITY_PRESETS)) {
      if (
        Math.abs(vadConfig.sensitivity_rms - preset.sensitivity_rms) < 0.001 &&
        Math.abs(vadConfig.noise_gate_threshold - preset.noise_gate_threshold) <
          0.001 &&
        vadConfig.min_speech_chunks === preset.min_speech_chunks
      ) {
        return key as SensitivityPreset;
      }
    }
    return "custom";
  };

  const currentPreset = getCurrentPreset();

  const handlePresetChange = (preset: SensitivityPreset) => {
    const presetValues = SENSITIVITY_PRESETS[preset];
    onUpdateVadConfig({
      ...vadConfig,
      sensitivity_rms: presetValues.sensitivity_rms,
      peak_threshold: presetValues.peak_threshold,
      noise_gate_threshold: presetValues.noise_gate_threshold,
      min_speech_chunks: presetValues.min_speech_chunks,
      silence_chunks: presetValues.silence_chunks,
    });
  };

  const handleResetDefaults = () => {
    const defaultConfig: VadConfig = {
      enabled: vadConfig.enabled, // Keep current mode
      hop_size: 1024,
      sensitivity_rms: 0.014,
      peak_threshold: 0.05,
      silence_chunks: 55,
      min_speech_chunks: 18,
      pre_speech_chunks: 12,
      noise_gate_threshold: 0.004,
      max_recording_duration_secs: 180,
    };
    onUpdateVadConfig(defaultConfig);
  };

  return (
    <div className="rounded-lg border border-border/50 bg-muted/30 p-3 space-y-4">
      {/* Recording Settings Section */}
      <div className="space-y-3">
            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              Recording
            </h4>

            {/* Sensitivity Presets - Only for VAD mode */}
            {vadConfig.enabled && (
              <div className="space-y-2">
                <Label className="text-xs font-medium">
                  Speech Sensitivity
                </Label>
                <div className="flex gap-2">
                  {(
                    Object.entries(SENSITIVITY_PRESETS) as [
                      SensitivityPreset,
                      (typeof SENSITIVITY_PRESETS)[SensitivityPreset]
                    ][]
                  ).map(([key, preset]) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => handlePresetChange(key)}
                      className={cn(
                        "flex-1 px-3 py-2 rounded-lg text-xs font-medium transition-all border",
                        currentPreset === key
                          ? "bg-primary text-primary-foreground border-primary"
                          : "bg-background border-border hover:bg-accent"
                      )}
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
                <p className="text-[10px] text-muted-foreground">
                  {currentPreset === "custom"
                    ? "Custom sensitivity values"
                    : SENSITIVITY_PRESETS[currentPreset as SensitivityPreset]
                        .description}
                </p>
              </div>
            )}

            {/* Max Duration - Only for Manual mode */}
            {!vadConfig.enabled && (
              <div className="space-y-2">
                <Label className="text-xs font-medium flex items-center justify-between">
                  <span>Max Recording Duration</span>
                  <span className="text-muted-foreground font-normal">
                    {Math.round(vadConfig.max_recording_duration_secs / 60)} min
                  </span>
                </Label>
                <Slider
                  value={[vadConfig.max_recording_duration_secs / 60]}
                  onValueChange={([value]) =>
                    onUpdateVadConfig({
                      ...vadConfig,
                      max_recording_duration_secs: Math.round(value * 60),
                    })
                  }
                  min={1}
                  max={3}
                  step={0.5}
                  className="w-full"
                />
              </div>
            )}
          </div>

          {/* Context Section */}
          <div className="space-y-3 pt-3 border-t border-border/50">
            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              AI Context
            </h4>

            <div className="flex items-center justify-between gap-4">
              <div className="flex-1">
                <Label className="text-xs font-medium">
                  Include Saved System Prompt
                </Label>
                <p className="text-[10px] text-muted-foreground mt-0.5">
                  Keep your saved behavior/style instructions and layer session context below.
                </p>
              </div>
              <Switch
                checked={useSystemPrompt}
                onCheckedChange={setUseSystemPrompt}
              />
            </div>

            {useSystemPrompt && (
              <div className="flex items-center justify-between gap-4">
                <Label className="text-xs font-medium shrink-0">Saved system prompt</Label>
                <Select
                  value={selectedPromptId ? String(selectedPromptId) : ""}
                  onValueChange={(value) => {
                    const prompt = savedPrompts.find((p) => String(p.id) === value);
                    if (prompt) onSelectPrompt?.(prompt);
                  }}
                  disabled={savedPrompts.length === 0}
                >
                  <SelectTrigger className="h-7 min-w-0 max-w-[60%] text-xs">
                    <SelectValue
                      placeholder={
                        savedPrompts.length === 0 ? "No saved prompts (default used)" : "Choose a prompt"
                      }
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {savedPrompts.map((prompt) => (
                      <SelectItem key={prompt.id} value={String(prompt.id)} className="text-xs">
                        {prompt.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Session documents: resume, JD and other evidence */}
            <SessionDocuments />
          </div>

          {/* Advanced Settings Toggle */}
          <div className="pt-3 border-t border-border/50">
            <button
              type="button"
              className="w-full flex items-center justify-between text-xs text-muted-foreground hover:text-foreground transition-colors"
              onClick={() => setShowAdvanced(!showAdvanced)}
            >
              <span>Advanced Settings</span>
              {showAdvanced ? (
                <ChevronUpIcon className="w-3 h-3" />
              ) : (
                <ChevronDownIcon className="w-3 h-3" />
              )}
            </button>

            {showAdvanced && (
              <div className="mt-3 space-y-3">
                {/* VAD-specific advanced settings */}
                {vadConfig.enabled && (
                  <>
                    <div className="space-y-2">
                      <Label className="text-xs font-medium flex items-center justify-between">
                        <span>Speech Sensitivity (Raw)</span>
                        <span className="text-muted-foreground font-normal">
                          {(vadConfig.sensitivity_rms * 1000).toFixed(1)}
                        </span>
                      </Label>
                      <Slider
                        value={[vadConfig.sensitivity_rms * 1000]}
                        onValueChange={([value]) =>
                          onUpdateVadConfig({
                            ...vadConfig,
                            sensitivity_rms: value / 1000,
                          })
                        }
                        min={1}
                        max={20}
                        step={0.5}
                        className="w-full"
                      />
                    </div>

                    <div className="space-y-2">
                      <Label className="text-xs font-medium flex items-center justify-between">
                        <span>Minimum Speech</span>
                        <span className="text-muted-foreground font-normal">
                          {(
                            (vadConfig.min_speech_chunks * vadConfig.hop_size) /
                            44100
                          ).toFixed(2)}
                          s
                        </span>
                      </Label>
                      <Slider
                        value={[vadConfig.min_speech_chunks]}
                        onValueChange={([value]) =>
                          onUpdateVadConfig({
                            ...vadConfig,
                            min_speech_chunks: Math.round(value),
                          })
                        }
                        min={8}
                        max={44}
                        step={2}
                        className="w-full"
                      />
                      <p className="text-[10px] text-muted-foreground">
                        Higher values reject very short noises and accidental triggers
                      </p>
                    </div>

                    <div className="space-y-2">
                      <Label className="text-xs font-medium flex items-center justify-between">
                        <span>Silence Duration</span>
                        <span className="text-muted-foreground font-normal">
                          {(
                            (vadConfig.silence_chunks * vadConfig.hop_size) /
                            44100
                          ).toFixed(1)}
                          s
                        </span>
                      </Label>
                      <Slider
                        value={[vadConfig.silence_chunks]}
                        onValueChange={([value]) =>
                          onUpdateVadConfig({
                            ...vadConfig,
                            silence_chunks: Math.round(value),
                          })
                        }
                        min={20}
                        max={180}
                        step={5}
                        className="w-full"
                      />
                      <p className="text-[10px] text-muted-foreground">
                        How long to wait after speech stops
                      </p>
                    </div>
                  </>
                )}

                {/* Noise gate - both modes */}
                <div className="space-y-2">
                  <Label className="text-xs font-medium flex items-center justify-between">
                    <span>Noise Gate</span>
                    <span className="text-muted-foreground font-normal">
                      {(vadConfig.noise_gate_threshold * 1000).toFixed(1)}
                    </span>
                  </Label>
                  <Slider
                    value={[vadConfig.noise_gate_threshold * 1000]}
                    onValueChange={([value]) =>
                      onUpdateVadConfig({
                        ...vadConfig,
                        noise_gate_threshold: value / 1000,
                      })
                    }
                    min={0}
                    max={10}
                    step={0.1}
                    className="w-full"
                  />
                  <p className="text-[10px] text-muted-foreground">
                    Filters background noise
                  </p>
                </div>

                {/* Reset button */}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleResetDefaults}
                  className="w-full text-xs"
                >
                  <RotateCcwIcon className="w-3 h-3 mr-1.5" />
                  Reset to Defaults
                </Button>
              </div>
            )}
          </div>
    </div>
  );
};
