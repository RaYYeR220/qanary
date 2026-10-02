// Stylus charges for every 64 KiB page in the module's initial memory, so shrink Rust's
// default 1 MiB shadow stack. A too-small stack traps (empty revert) instead of erroring.
// Override with PQ_STACK_SIZE=<bytes>.
fn main() {
    println!("cargo:rerun-if-env-changed=PQ_STACK_SIZE");
    let size = std::env::var("PQ_STACK_SIZE").unwrap_or_else(|_| "131072".into());
    println!("cargo:rustc-link-arg-cdylib=-zstack-size={size}");
}
