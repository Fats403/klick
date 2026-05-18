// Shared mutable ref to the <video> element so non-Preview components (timeline,
// transport, hooks) can read/write currentTime, paused, etc. without having to
// thread the ref through React props.

export const videoRef: { current: HTMLVideoElement | null } = { current: null };
