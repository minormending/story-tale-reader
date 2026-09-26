package com.kramdath.storytalereader;

import android.content.ContentResolver;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.DocumentsContract;
import android.provider.Settings;

import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.util.ArrayDeque;
import java.util.Arrays;
import java.util.Comparator;
import java.util.ArrayList;
import java.util.Deque;
import java.util.List;
import java.util.Locale;

/**
 * Choosing a whole folder of books, which the web layer cannot do on Android.
 *
 * `<input webkitdirectory>` is ignored by Chrome for Android: it opens an ordinary
 * file picker, so the browser has no way to offer a folder at all. The Storage
 * Access Framework does, and only native code can reach it.
 *
 * Two steps on purpose. Picking returns a *list* — name, size and a document URI
 * per book — which is cheap whatever the folder holds. Reading copies one book into
 * the cache and returns its path (see IncomingFiles), and is called once per book as
 * the import reaches it, so a folder of forty books never has forty in flight.
 *
 * Downloads is the exception. Since Android 11 the folder picker refuses it outright
 * ("to protect your privacy, choose another folder"), along with the root of storage,
 * so no amount of asking through the picker will reach it — and Downloads is where
 * people keep their books, and where their other reading apps look. The only way in
 * is "All files access" (MANAGE_EXTERNAL_STORAGE), which the reader turns on in
 * Android's settings; with it, Downloads is listed directly from the file system.
 * It is asked for only when someone chooses Downloads, and only book files are read.
 */
@CapacitorPlugin(name = "FolderPicker")
public class FolderPickerPlugin extends Plugin {

    /** Matches the extensions the web layer will accept; contents are sniffed later. */
    private static final String[] BOOK_SUFFIXES = { ".epub", ".pdf", ".mobi", ".azw3", ".prc" };

    /** A folder this large is a mistake, not a shelf. */
    private static final int MAX_FILES = 500;

    /** Calibre nests author/title/book; a handful of levels is plenty. */
    private static final int MAX_DEPTH = 8;

    @PluginMethod
    public void pick(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        startActivityForResult(call, intent, "folderPicked");
    }

    @ActivityCallback
    private void folderPicked(PluginCall call, ActivityResult result) {
        if (call == null) return;

        Intent data = result.getData();
        Uri tree = data == null ? null : data.getData();
        JSObject out = new JSObject();

        // Backing out of the picker is an answer, not a failure.
        if (tree == null) {
            out.put("cancelled", true);
            out.put("books", new JSArray());
            call.resolve(out);
            return;
        }

        try {
            List<JSObject> found = walk(tree);
            JSArray books = new JSArray();
            for (JSObject book : found) books.put(book);
            out.put("cancelled", false);
            out.put("books", books);
            call.resolve(out);
        } catch (Exception failure) {
            call.reject("Could not read that folder: " + failure.getMessage());
        }
    }

    /**
     * Every book under the chosen folder, breadth-first.
     *
     * Breadth-first rather than depth-first so that a folder of loose books yields
     * them before descending into whatever else is in there, and so a run into a
     * deep tree still returns something useful when it hits the limits.
     */
    private List<JSObject> walk(Uri tree) {
        ContentResolver resolver = getContext().getContentResolver();
        List<JSObject> books = new ArrayList<>();

        Deque<String[]> queue = new ArrayDeque<>();
        queue.add(new String[] { DocumentsContract.getTreeDocumentId(tree), "0" });

        while (!queue.isEmpty() && books.size() < MAX_FILES) {
            String[] entry = queue.removeFirst();
            String parentId = entry[0];
            int depth = Integer.parseInt(entry[1]);

            Uri children = DocumentsContract.buildChildDocumentsUriUsingTree(tree, parentId);
            String[] columns = {
                DocumentsContract.Document.COLUMN_DOCUMENT_ID,
                DocumentsContract.Document.COLUMN_DISPLAY_NAME,
                DocumentsContract.Document.COLUMN_MIME_TYPE,
                DocumentsContract.Document.COLUMN_SIZE,
            };

            try (Cursor cursor = resolver.query(children, columns, null, null, null)) {
                if (cursor == null) continue;
                while (cursor.moveToNext() && books.size() < MAX_FILES) {
                    String id = cursor.getString(0);
                    String name = cursor.getString(1);
                    String mime = cursor.getString(2);
                    long size = cursor.isNull(3) ? 0 : cursor.getLong(3);

                    if (DocumentsContract.Document.MIME_TYPE_DIR.equals(mime)) {
                        if (depth + 1 <= MAX_DEPTH) {
                            queue.add(new String[] { id, String.valueOf(depth + 1) });
                        }
                        continue;
                    }

                    if (name == null || !looksLikeABook(name)) continue;

                    JSObject book = new JSObject();
                    book.put("uri", DocumentsContract.buildDocumentUriUsingTree(tree, id).toString());
                    book.put("name", name);
                    book.put("size", size);
                    books.add(book);
                }
            } catch (Exception skip) {
                // One unreadable subfolder should not lose the rest of the shelf.
            }
        }

        return books;
    }

    private boolean looksLikeABook(String name) {
        String lower = name.toLowerCase(Locale.ROOT);
        for (String suffix : BOOK_SUFFIXES) {
            if (lower.endsWith(suffix)) return true;
        }
        return false;
    }

    /**
     * One book, for the import to take when it gets to it: streamed into the cache
     * and handed over as a path, like BookIntentPlugin, rather than as base64.
     */
    @PluginMethod
    public void read(PluginCall call) {
        String raw = call.getString("uri");
        if (raw == null) {
            call.reject("No book was named");
            return;
        }
        new Thread(() -> {
            try {
                File copy = IncomingFiles.copy(getContext(), Uri.parse(raw));
                JSObject out = new JSObject();
                out.put("path", copy.getAbsolutePath());
                out.put("size", copy.length());
                call.resolve(out);
            } catch (Exception failure) {
                call.reject("Could not read that book: " + failure.getMessage());
            }
        }, "folder-picker-copy").start();
    }

    /* ------------------------------ Downloads ------------------------------ */

    /**
     * Whether Downloads needs a permission on this device, and whether it has it.
     * Below Android 11 the folder picker still offers Downloads, so nothing is needed.
     */
    @PluginMethod
    public void downloadsAccess(PluginCall call) {
        JSObject out = new JSObject();
        out.put("needsPermission", Build.VERSION.SDK_INT >= Build.VERSION_CODES.R);
        out.put("granted", hasDownloadsAccess());
        call.resolve(out);
    }

    /** Opens Android's "All files access" screen for this app, and answers once the reader is back. */
    @PluginMethod
    public void requestDownloadsAccess(PluginCall call) {
        if (hasDownloadsAccess() || Build.VERSION.SDK_INT < Build.VERSION_CODES.R) {
            JSObject out = new JSObject();
            out.put("granted", hasDownloadsAccess());
            call.resolve(out);
            return;
        }
        Intent intent = new Intent(
            Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION,
            Uri.parse("package:" + getContext().getPackageName())
        );
        // Some builds of Android only offer the list of every app, not this app's page.
        if (intent.resolveActivity(getContext().getPackageManager()) == null) {
            intent = new Intent(Settings.ACTION_MANAGE_ALL_FILES_ACCESS_PERMISSION);
        }
        startActivityForResult(call, intent, "downloadsAccessAnswered");
    }

    @ActivityCallback
    private void downloadsAccessAnswered(PluginCall call, ActivityResult result) {
        if (call == null) return;
        // The settings screen reports nothing useful as its result: ask the system.
        JSObject out = new JSObject();
        out.put("granted", hasDownloadsAccess());
        call.resolve(out);
    }

    private boolean hasDownloadsAccess() {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.R && Environment.isExternalStorageManager();
    }

    /**
     * Every book in Downloads and the folders inside it, breadth-first and within the
     * same limits as a picked folder. Returned as file paths, which the web layer
     * fetches straight from disk through Capacitor's local server: no copy, and
     * nothing to discard afterwards, because the file is the reader's own.
     */
    @PluginMethod
    public void scanDownloads(PluginCall call) {
        if (!hasDownloadsAccess()) {
            call.reject("Story Tale does not have access to Downloads", "NO_ACCESS");
            return;
        }
        new Thread(() -> {
            try {
                File root = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS);
                JSArray books = new JSArray();
                for (File file : scan(root)) {
                    JSObject book = new JSObject();
                    book.put("path", file.getAbsolutePath());
                    book.put("name", file.getName());
                    book.put("size", file.length());
                    books.put(book);
                }
                JSObject out = new JSObject();
                out.put("books", books);
                call.resolve(out);
            } catch (Exception failure) {
                call.reject("Could not read Downloads: " + failure.getMessage());
            }
        }, "downloads-scan").start();
    }

    private List<File> scan(File root) {
        List<File> books = new ArrayList<>();
        Deque<File> folders = new ArrayDeque<>();
        Deque<Integer> depths = new ArrayDeque<>();
        folders.add(root);
        depths.add(0);

        while (!folders.isEmpty() && books.size() < MAX_FILES) {
            File folder = folders.removeFirst();
            int depth = depths.removeFirst();
            File[] children = folder.listFiles();
            if (children == null) continue;
            // Listings come back in no particular order; a stable one keeps the
            // import's "Adding 3 of 12" meaning the same thing twice running.
            Arrays.sort(children, Comparator.comparing(File::getName, String.CASE_INSENSITIVE_ORDER));
            for (File child : children) {
                if (books.size() >= MAX_FILES) break;
                // .thumbnails, .trashed-…, and whatever else an app hides in there.
                if (child.getName().startsWith(".")) continue;
                if (child.isDirectory()) {
                    if (depth + 1 <= MAX_DEPTH) {
                        folders.add(child);
                        depths.add(depth + 1);
                    }
                } else if (child.isFile() && looksLikeABook(child.getName())) {
                    books.add(child);
                }
            }
        }
        return books;
    }

    @PluginMethod
    public void discard(PluginCall call) {
        IncomingFiles.discard(getContext(), call.getString("path"));
        call.resolve();
    }
}
