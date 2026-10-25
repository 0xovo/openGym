// The home-screen icons a phone can switch to (Settings → Look & Home → App icon). Plain data, no
// imports: scripts/app-icons.mjs draws every icon file from this list and the settings row lists
// the same ids, so the picker can never offer an icon the native projects do not have.
//
// `name` is the English key the row passes to t(). `ios` is the AppIcon set in the asset catalog
// (null: the primary icon) and `android` the activity-alias in AndroidManifest.xml.
export const APP_ICON_VARIANTS = [
  { id: 'default', name: 'Original', bg: '#0c0e12', fg: '#a3e635', ios: null, android: 'IconDefault' },
  { id: 'light', name: 'Light', bg: '#ffffff', fg: '#65a30d', ios: 'AppIcon-Light', android: 'IconLight' },
  { id: 'mono', name: 'Mono', bg: '#0c0e12', fg: '#f2f2f7', ios: 'AppIcon-Mono', android: 'IconMono' },
  { id: 'neon', name: 'Green', bg: '#a3e635', fg: '#0c0e12', ios: 'AppIcon-Neon', android: 'IconNeon' },
  { id: 'sky', name: 'Blue', bg: '#0a84ff', fg: '#ffffff', ios: 'AppIcon-Sky', android: 'IconSky' },
  { id: 'orange', name: 'Orange', bg: '#ff9f0a', fg: '#0c0e12', ios: 'AppIcon-Orange', android: 'IconOrange' },
  { id: 'pink', name: 'Pink', bg: '#ff375f', fg: '#ffffff', ios: 'AppIcon-Pink', android: 'IconPink' },
  { id: 'violet', name: 'Purple', bg: '#bf5af2', fg: '#ffffff', ios: 'AppIcon-Violet', android: 'IconViolet' },
]

export const APP_ICON_IDS = APP_ICON_VARIANTS.map(v => v.id)
