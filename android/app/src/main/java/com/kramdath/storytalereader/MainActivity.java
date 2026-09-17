package com.kramdath.storytalereader;

import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(BookIntentPlugin.class);
        super.onCreate(savedInstanceState);
        captureBook(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        captureBook(intent);
    }

    /** Pick the book URI out of a VIEW or SEND intent, if there is one. */
    private void captureBook(Intent intent) {
        if (intent == null) return;
        String action = intent.getAction();
        Uri uri = null;

        if (Intent.ACTION_VIEW.equals(action)) {
            uri = intent.getData();
        } else if (Intent.ACTION_SEND.equals(action)) {
            uri = intent.getParcelableExtra(Intent.EXTRA_STREAM);
        }

        if (uri != null) BookIntentPlugin.offer(uri);
    }
}
