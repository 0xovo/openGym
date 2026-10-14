package ch.duartesantos.opengym;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** A gym's proximity alert fired (GymReminder). Explicit and not exported: only the system's alert reaches it. */
public class GymReminderReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null || !GymReminder.actionEnter(context).equals(intent.getAction())) return;
        final PendingResult pending = goAsync();
        final Context app = context.getApplicationContext();
        new Thread(() -> {
            try {
                GymReminder.onAlert(app, intent);
            } finally {
                pending.finish();
            }
        }, "opengym-gym").start();
    }
}
