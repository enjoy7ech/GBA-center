import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'

createRoot(document.getElementById('root')!).render(
  <App />,
)

const stopZoom = (event: Event) => event.preventDefault()
const stopMultiTouchZoom = (event: TouchEvent) => {
  if (event.touches.length > 1) event.preventDefault()
}
const stopKeyboardZoom = (event: KeyboardEvent) => {
  if ((event.ctrlKey || event.metaKey) && ['+', '=', '-', '0'].includes(event.key)) event.preventDefault()
}
const stopWheelZoom = (event: WheelEvent) => {
  if (event.ctrlKey || event.metaKey) event.preventDefault()
}

document.addEventListener('gesturestart', stopZoom, { passive: false })
document.addEventListener('gesturechange', stopZoom, { passive: false })
document.addEventListener('gestureend', stopZoom, { passive: false })
document.addEventListener('touchmove', stopMultiTouchZoom, { passive: false })
document.addEventListener('dblclick', stopZoom, { passive: false })
window.addEventListener('keydown', stopKeyboardZoom, true)
window.addEventListener('wheel', stopWheelZoom, { passive: false })

if ('serviceWorker' in navigator) {
  if (import.meta.env.PROD) {
    window.addEventListener('load', () => {
      void navigator.serviceWorker.register('/sw.js').then(registration => {
        void registration.update()
        window.setInterval(() => void registration.update(), 60 * 60 * 1000)
      }).catch(error => console.warn('[PWA] Service Worker 注册失败', error))
    })
  } else {
    // A production worker previously installed on localhost keeps controlling
    // Vite and can serve stale source modules. Remove it during development.
    void navigator.serviceWorker.getRegistrations().then(async registrations => {
      const hadController = Boolean(navigator.serviceWorker.controller)
      await Promise.all(registrations.map(registration => registration.unregister()))
      if ('caches' in window) {
        const keys = await caches.keys()
        await Promise.all(keys.filter(key => key.startsWith('gba-center-')).map(key => caches.delete(key)))
      }
      if (hadController && !sessionStorage.getItem('gba-dev-sw-cleared')) {
        sessionStorage.setItem('gba-dev-sw-cleared', '1')
        window.location.reload()
      }
    })
  }
}
