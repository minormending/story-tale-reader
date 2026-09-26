package com.kramdath.storytalereader;

import android.content.ContentResolver;
import android.database.Cursor;
import android.net.Uri;
import android.provider.OpenableColumns;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;

/**
 * Hands a book opened from outside the app (a file manager's "Open with", or the
 * share sheet) to the web layer.
 *
 * The book is streamed into the app's cache (IncomingFiles) and its path handed
 * over; the web layer reads it through Capacitor's local server and then asks for
 * the copy to be discarded. Nothing the size of the book passes through the bridge
 * or sits in the Java heap.
 */
@CapacitorPlugin(name = "BookIntent")
public class BookIntentPlugin extends Plugin {

    private static Uri pending;
    private static BookIntentPlugin instance;

    @Override
    public void load() {
        instance = this;
        IncomingFiles.clearStale(getContext());
    }

    /** Called by MainActivity when an intent carrying a book arrives. */
    static void offer(Uri uri) {
        pending = uri;
        if (instance != null) {
            instance.notifyListeners("bookOpened", new JSObject(), true);
        }
    }

    @PluginMethod
    public void take(PluginCall call) {
        Uri uri = pending;
        pending = null;

        JSObject result = new JSObject();
        if (uri == null) {
            result.put("available", false);
            call.resolve(result);
            return;
        }

        // Copying can take a few seconds for a large book; keep it off the bridge thread.
        new Thread(() -> {
            try {
                File copy = IncomingFiles.copy(getContext(), uri);
                result.put("available", true);
                result.put("name", displayName(getContext().getContentResolver(), uri));
                result.put("path", copy.getAbsolutePath());
                result.put("size", copy.length());
                call.resolve(result);
            } catch (Exception error) {
                call.reject("Could not open that book: " + error.getMessage());
            }
        }, "book-intent-copy").start();
    }

    @PluginMethod
    public void discard(PluginCall call) {
        IncomingFiles.discard(getContext(), call.getString("path"));
        call.resolve();
    }

    private String displayName(ContentResolver resolver, Uri uri) {
        if ("content".equals(uri.getScheme())) {
            try (Cursor cursor = resolver.query(uri, null, null, null, null)) {
                if (cursor != null && cursor.moveToFirst()) {
                    int column = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                    if (column >= 0) {
                        String name = cursor.getString(column);
                        if (name != null && !name.isEmpty()) return name;
                    }
                }
            } catch (Exception ignored) {
                // Fall through to the path-derived name.
            }
        }
        String path = uri.getLastPathSegment();
        return path == null || path.isEmpty() ? "book.epub" : path;
    }
}
