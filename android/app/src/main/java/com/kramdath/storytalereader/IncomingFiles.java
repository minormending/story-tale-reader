package com.kramdath.storytalereader;

import android.content.ContentResolver;
import android.content.Context;
import android.net.Uri;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;

/**
 * Books arriving from outside the web layer — "Open with", the share sheet, a
 * picked folder — are streamed to a file in the app's cache, and the web layer
 * fetches that file through Capacitor's local server (Capacitor.convertFileSrc).
 *
 * They used to cross the bridge as one base64 string. That meant the whole book
 * several times over in the Java heap at once — the bytes, a growing buffer, the
 * encoded string at two bytes a character, and the JSON around it — and on a cheap
 * tablet with a 256 MB heap limit anything over roughly 40 MB threw
 * OutOfMemoryError. Streaming holds one small buffer, whatever the size of the book.
 */
final class IncomingFiles {

    /** Larger than any picture book; a file this big is a mistake, not a book. */
    static final long MAX_BYTES = 500L * 1024 * 1024;

    private IncomingFiles() {}

    static File directory(Context context) {
        File dir = new File(context.getCacheDir(), "incoming");
        //noinspection ResultOfMethodCallIgnored
        dir.mkdirs();
        return dir;
    }

    /** Copies the content behind a URI into the incoming folder and returns the file. */
    static File copy(Context context, Uri uri) throws IOException {
        ContentResolver resolver = context.getContentResolver();
        File target = File.createTempFile("book-", ".bin", directory(context));
        try (InputStream input = resolver.openInputStream(uri);
             OutputStream output = new FileOutputStream(target)) {
            if (input == null) throw new IOException("the file could not be opened");
            byte[] buffer = new byte[256 * 1024];
            long total = 0;
            int read;
            while ((read = input.read(buffer)) != -1) {
                total += read;
                if (total > MAX_BYTES) throw new IOException("the file is larger than 500 MB");
                output.write(buffer, 0, read);
            }
        } catch (IOException | RuntimeException error) {
            //noinspection ResultOfMethodCallIgnored
            target.delete();
            throw error;
        }
        return target;
    }

    /** Deletes a copy once the web layer has read it. Only ever inside the incoming folder. */
    static boolean discard(Context context, String path) {
        if (path == null) return false;
        File file = new File(path);
        File dir = directory(context);
        try {
            if (!file.getCanonicalFile().getParentFile().equals(dir.getCanonicalFile())) return false;
        } catch (IOException error) {
            return false;
        }
        return file.delete();
    }

    /** Clears copies a previous run never collected (the app was killed mid-import, say). */
    static void clearStale(Context context) {
        File[] files = directory(context).listFiles();
        if (files == null) return;
        long cutoff = System.currentTimeMillis() - 60 * 60 * 1000;
        for (File file : files) {
            //noinspection ResultOfMethodCallIgnored
            if (file.lastModified() < cutoff) file.delete();
        }
    }
}
