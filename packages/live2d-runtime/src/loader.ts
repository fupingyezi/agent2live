let corePromise: Promise<void> | null = null

function injectScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = src
    script.onload = () => resolve()
    script.onerror = () => reject(new Error('LIVE2D_CORE_MISSING'))
    document.head.appendChild(script)
  })
}

export function loadCubismCore(): Promise<void> {
  corePromise ??= (async () => {
    if (!('Live2DCubismCore' in window)) {
      await injectScript(new URL('../live2d/live2dcubismcore.min.js', document.baseURI).href)
    }
    if (!('Live2DCubismCore' in window)) throw new Error('LIVE2D_CORE_MISSING')
  })().catch((error: unknown) => {
    corePromise = null
    throw error
  })
  return corePromise
}

export function isCubismCoreLoaded(): boolean {
  return 'Live2DCubismCore' in window
}
