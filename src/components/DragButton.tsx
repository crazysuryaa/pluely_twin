import { useEffect, useState } from "react";
import { GripVerticalIcon } from "lucide-react";
import { useApp } from "@/contexts";
import {
  GetLicense,
  Button,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components";
import { useWindowResize } from "@/hooks";
import { getCurrentWindow } from "@tauri-apps/api/window";

export const DragButton = () => {
  const { hasActiveLicense } = useApp();
  const [isOpen, setIsOpen] = useState(false);
  const { resizeWindow } = useWindowResize();

  useEffect(() => {
    if (!hasActiveLicense) {
      resizeWindow(isOpen);
    }
  }, [hasActiveLicense, isOpen, resizeWindow]);

  if (!hasActiveLicense) {
    return (
      <Popover open={isOpen} onOpenChange={setIsOpen}>
        <PopoverTrigger asChild className="border-none hover:bg-transparent">
          <Button variant="ghost" size="icon" className="-ml-[2px] w-fit">
            <GripVerticalIcon className="h-4 w-4" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          side="bottom"
          className="w-fit select-none p-4 border overflow-hidden border-input/50"
          sideOffset={8}
        >
          <div className="flex flex-col gap-2 w-116">
            <div className="flex flex-col gap-1 pb-2">
              <p className="text-md font-medium">
                You need an active license to use this feature.
              </p>
              <p className="text-sm font-medium text-muted-foreground">
                Once you complete your purchase, you'll receive a license key
                via email. Paste in the Settings → Pluely Access section to
                activate.
              </p>
            </div>
            <GetLicense setState={setIsOpen} />
          </div>
        </PopoverContent>
      </Popover>
    );
  }

  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label="Drag window"
      className="-ml-[2px] w-fit cursor-grab active:cursor-grabbing text-white/50 hover:text-white hover:bg-white/10"
      data-tauri-drag-region="true"
      title="Drag window"
      onMouseDown={(e) => {
        if (e.button === 0) {
          void getCurrentWindow().startDragging().catch(console.error);
        }
      }}
    >
      <GripVerticalIcon className="h-4 w-4 pointer-events-none" />
    </Button>
  );
};
