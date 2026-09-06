/** Register PWA service worker (web only; skip Electron). */
export function registerPwa(): void {
  if (typeof window === 'undefined') return
  if (typeof window.api?.win !== 'undefined') return
  if (!('serviceWorker' in navigator)) return

  const register = () => {
    const swUrl = `${import.meta.env.BASE_URL}sw.js`
    navigator.serviceWorker.register(swUrl).catch((err) => {
      console.warn('[pwa] sw register failed', err)
    })
  }

  if (document.readyState === 'complete') register()
  else window.addEventListener('load', register)
}