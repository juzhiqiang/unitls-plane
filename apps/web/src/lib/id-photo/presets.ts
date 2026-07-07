export const idPhotoPresetOptions = [
  { key: 'one_inch', labelKey: 'presets.oneInch', size: '295 x 413' },
  { key: 'two_inch', labelKey: 'presets.twoInch', size: '413 x 626' },
  {
    key: 'small_one_inch',
    labelKey: 'presets.smallOneInch',
    size: '260 x 378',
  },
  { key: 'passport', labelKey: 'presets.passport', size: '413 x 531' },
] as const;

export const idPhotoBackgroundOptions = [
  { key: 'blue', color: '#438edb', labelKey: 'backgrounds.blue' },
  { key: 'white', color: '#ffffff', labelKey: 'backgrounds.white' },
  { key: 'red', color: '#d82727', labelKey: 'backgrounds.red' },
] as const;
