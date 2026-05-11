<script>
  let { name, size = 20, stroke = 'currentColor' } = $props()

  const paths = {
    lock:          '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
    unlock:        '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 7.5-2"/>',
    search:        '<circle cx="11" cy="11" r="6"/><path d="m20 20-4.3-4.3"/>',
    plus:          '<path d="M12 5v14M5 12h14"/>',
    'chevron-down':  '<path d="m6 9 6 6 6-6"/>',
    'chevron-right': '<path d="m9 6 6 6-6 6"/>',
    'chevron-left':  '<path d="m15 6-6 6 6 6"/>',
    copy:          '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>',
    eye:           '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
    'eye-off':     '<path d="M3 3l18 18"/><path d="M10.6 6.1A10 10 0 0 1 12 6c6.5 0 10 6 10 6a17 17 0 0 1-3.4 4"/><path d="M6.2 6.2A17 17 0 0 0 2 12s3.5 6 10 6c1.5 0 2.9-.3 4.1-.8"/><path d="M14.1 14.1a3 3 0 0 1-4.2-4.2"/>',
    external:      '<path d="M14 4h6v6"/><path d="M20 4 10 14"/><path d="M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5"/>',
    edit:          '<path d="M4 20h4l10-10-4-4L4 16v4Z"/><path d="m14 6 4 4"/>',
    trash:         '<path d="M4 7h16"/><path d="M9 7V4h6v3"/><path d="M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13"/>',
    more:          '<circle cx="12" cy="6" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="12" cy="18" r="1.4"/>',
    check:         '<path d="m5 12 5 5L20 7"/>',
    x:             '<path d="M6 6l12 12M18 6 6 18"/>',
    back:          '<path d="M15 6 9 12l6 6"/>',
    'face-id':     '<path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2"/><path d="M9 10v2M15 10v2M12 9v4l-1 1M9 16s1 1 3 1 3-1 3-1"/>',
    refresh:       '<path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 4v5h-5"/>',
    settings:      '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
  }
</script>

<svg
  width={size}
  height={size}
  viewBox="0 0 24 24"
  fill="none"
  {stroke}
  stroke-width="1.6"
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden="true"
>
  {@html paths[name] ?? ''}
</svg>
