# src-tauri/src/lib.rs integration

Add:
```rust
mod remote;
```

Manage state:
```rust
.manage(remote::RemoteState::default())
```

Register commands:
```rust
remote::start_remote_commenter,
remote::stop_remote_commenter,
remote::get_remote_commenter_status,
remote::publish_host_event,
```
