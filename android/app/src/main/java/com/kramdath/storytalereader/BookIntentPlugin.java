package com.kramdath.storytalereader;

import android.content.ContentResolver;
import android.database.Cursor;
import android.net.Uri;
import android.provider.OpenableColumns;
import android.util.Base64;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;

/**
 * Hands a book opened from outside the app (a file manager's "Open with", or the
 * share sheet) to the web layer.
 *
 * The bytes cross the bridge base64-encoded. That is not free, but the web layer
 * stores books in OPFS, which native code cannot write to, so there is no shared
 * filesystem to hand a path across instead. Children's picture books are tens of
 * megabytes, which is comfortably within budget; anything larger is refused with a
 * clear message rather than risking an out-of-memory kill.
 */
@CapacitorPlugin(name = "BookIntent")
public class BookIntentPlugin extends Plugin {

    private static final long MAX_BYTES = 150L * 1024 * 1024;

    private static Uri pending;
    private static BookIntentPlugin instance;

    @Override
    public void load() {
        instance = this;
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

        try {
            ContentResolver resolver = getContext().getContentResolver();
            byte[] bytes = readAll(resolver, uri);
            result.put("available", true);
            result.put("name", displayName(resolver, uri));
            result.put("data", Base64.encodeToString(bytes, Base64.NO_WRAP));
            call.resolve(result);
        } catch (OutOfMemoryError error) {
            call.reject("That book is too large to open this way. Add it from the app instead.");
        } catch (Exception error) {
            call.reject("Could not read that file: " + error.getMessage());
        }
    }

    private byte[] readAll(ContentResolver resolver, Uri uri) throws Exception {
        try (InputStream input = resolver.openInputStream(uri)) {
            if (input == null) throw new IllegalStateException("the file could not be opened");
            ByteArrayOutputStream output = new ByteArrayOutputStream();
            byte[] buffer = new byte[64 * 1024];
            long total = 0;
            int read;
            while ((read = input.read(buffer)) != -1) {
                total += read;
                if (total > MAX_BYTES) {
                    throw new IllegalStateException("the file is larger than 150 MB");
                }
                output.write(buffer, 0, read);
            }
            return output.toByteArray();
        }
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
