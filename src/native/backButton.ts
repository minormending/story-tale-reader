/**
 * Android's back button.
 *
 * Capacitor's App plugin takes the button over, and with nothing listening it only
 * steps back through the WebView's history. This app changes screens without
 * touching history, so there was never anything to go back to: the button did
 * nothing at all, anywhere — including from a book whose controls had hidden,
 * which left no way out but to quit the app.
 *
 * Whatever is on top answers first. Screens register a handler while they have
 * something to close (a menu, a picker, the book itself) and return true when they
 * dealt with the press. When nothing does, the app goes to the background, which is
 * what back does on an app's first screen everywhere else on Android.
 */

import { App as CapacitorApp } from '@capacitor/app'
import { Capacitor } from '@capacitor/core'

type Handler = () => boolean

const handlers: Handler[] = []
let listening = false

/** Handle back while mounted; the most recently registered handler goes first. */
export function onBackButton(handler: Handler): () => void {
  handlers.push(handler)
  listen()
  return () => {
    const index = handlers.lastIndexOf(handler)
    if (index !== -1) handlers.splice(index, 1)
  }
}

/** Take the button over once, at startup, so it answers even with nothing registered. */
export function startBackButton(): void {
  listen()
}

function listen(): void {
  if (listening || !Capacitor.isNativePlatform()) return
  listening = true
  void CapacitorApp.addListener('backButton', () => {
    for (let i = handlers.length - 1; i >= 0; i--) {
      if (handlers[i]?.()) return
    }
    void CapacitorApp.minimizeApp()
  })
}
