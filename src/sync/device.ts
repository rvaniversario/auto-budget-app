/** A short, human name for this device, shown in the account's device list. */
export function deviceLabel(): string {
  if (typeof navigator === 'undefined') return 'Device'
  const ua = navigator.userAgent
  if (/iPad/.test(ua) || (ua.includes('Macintosh') && navigator.maxTouchPoints > 1)) return 'iPad'
  if (/iPhone|iPod/.test(ua)) return 'iPhone'
  if (/Android/.test(ua)) return /Mobile/.test(ua) ? 'Android phone' : 'Android tablet'
  if (/Windows/.test(ua)) return 'Windows computer'
  if (/Macintosh|Mac OS X/.test(ua)) return 'Mac'
  if (/CrOS/.test(ua)) return 'Chromebook'
  if (/Linux/.test(ua)) return 'Linux computer'
  return 'Browser'
}

/** Group device labels for display: "This iPhone, 1 laptop". */
export function describeDevices(labels: { id: string; label: string }[], thisDeviceId: string | null): string {
  const others = labels.filter((d) => d.id !== thisDeviceId)
  const self = labels.find((d) => d.id === thisDeviceId)
  const parts: string[] = []
  if (self) parts.push(`This ${self.label}`)
  const counts = new Map<string, number>()
  for (const d of others) {
    const kind = /phone|iPhone/i.test(d.label)
      ? 'phone'
      : /iPad|tablet/i.test(d.label)
        ? 'tablet'
        : /Windows|Mac|Linux|Chromebook|computer/i.test(d.label)
          ? 'computer'
          : 'device'
    counts.set(kind, (counts.get(kind) ?? 0) + 1)
  }
  for (const [kind, n] of counts) parts.push(`${n} ${kind}${n === 1 ? '' : 's'}`)
  return parts.join(', ') || 'None yet'
}
