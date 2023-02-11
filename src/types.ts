declare global {
  interface Window {
    roamAlphaAPI?: any
  }
}

export type RoamPrivateApiOptions = {
  headless: boolean,
  folder: string,
  nodownload: boolean,
}

