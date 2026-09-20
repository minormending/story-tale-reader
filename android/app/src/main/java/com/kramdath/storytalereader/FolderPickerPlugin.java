package com.kramdath.storytalereader;

import android.content.ContentResolver;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.provider.DocumentsContract;
import android.util.Base64;

import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.util.ArrayDeque;
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
 * per book — which is cheap whatever the folder holds. Reading returns one book's
 * bytes, base64-encoded, and is called once per book as the import reaches it.
 * Handing forty books across the bridge at once would mean forty files in memory
 * simultaneously, which on the cheap tablets this reader is for is an
 * out-of-memory kill rather than a slow import.
 */
@CapacitorPlugin(name = "FolderPicker")
public class FolderPickerPlugin extends Plugin {

    /** Matches the extensions the web layer will accept; contents are sniffed later. */
    private static final String[] BOOK_SUFFIXES = { ".epub", ".pdf", ".mobi", ".azw3", ".prc" };

    /** A folder this large is a mistake, not a shelf. */
    private static final int MAX_FILES = 500;

    /** Calibre nests author/title/book; a handful of levels is plenty. */
    private static final int MAX_DEPTH = 8;

    private static final long MAX_BYTES = 150L * 1024 * 1024;

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

    /** One book's bytes, for the import to take when it gets to it. */
    @PluginMethod
    public void read(PluginCall call) {
        String raw = call.getString("uri");
        if (raw == null) {
            call.reject("No book was named");
            return;
        }

        try {
            Uri uri = Uri.parse(raw);
            ContentResolver resolver = getContext().getContentResolver();
            try (InputStream stream = resolver.openInputStream(uri)) {
                if (stream == null) {
                    call.reject("That book could not be opened");
                    return;
                }

                ByteArrayOutputStream buffer = new ByteArrayOutputStream();
                byte[] chunk = new byte[64 * 1024];
                long total = 0;
                int read;
                while ((read = stream.read(chunk)) != -1) {
                    total += read;
                    if (total > MAX_BYTES) {
                        call.reject("That book is too large to open on this device");
                        return;
                    }
                    buffer.write(chunk, 0, read);
                }

                JSObject out = new JSObject();
                out.put("data", Base64.encodeToString(buffer.toByteArray(), Base64.NO_WRAP));
                call.resolve(out);
            }
        } catch (Exception failure) {
            call.reject("Could not read that book: " + failure.getMessage());
        }
    }
}
