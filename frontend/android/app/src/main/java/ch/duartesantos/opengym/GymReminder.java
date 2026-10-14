package ch.duartesantos.opengym;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.location.LocationManager;
import android.os.Build;
import java.util.Calendar;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * The gym reminder (#614): a notification when the phone walks into one of the user's gyms.
 *
 * The platform's own proximity alerts (LocationManager.addProximityAlert) watch the gyms, so it
 * works without Google Play Services (the APK and F-Droid builds too) and with the app closed; the
 * system hands GymReminderReceiver a broadcast on entering, which decides with GymReminderRules
 * whether to post. Proximity alerts do not survive a restart or an app update:
 * GymReminderBootReceiver registers them again.
 *
 * What is kept, in the app's private preferences: the config the page saved (gyms with their
 * places, the time window), the status it last reported (last day trained, a running session, the
 * notification's words) and the day it last went off. That file is left out of Android's cloud
 * backup and device transfer (res/xml/backup_rules.xml, data_extraction_rules.xml): the places
 * stay on this phone, and never go to the user's server either.
 */
final class GymReminder {
    static final String PREFS = "opengym_gym_reminder";
    static final String CHANNEL_ID = "gym-reminder";
    static final int NOTIFICATION_ID = 3000;
    static final int MAX_GYMS = 20;
    /** The request codes of the proximity alerts' PendingIntents: one per gym slot. */
    private static final int REQUEST_BASE = 46_300;
    /**
     * An alert reports "entering" as soon as it is added while the phone is already inside, which
     * would ping right after "I'm at the gym right now". Entries this soon after arming are ignored.
     */
    static final long ARM_GRACE_MS = 90_000L;

    static String actionEnter(Context ctx) { return ctx.getPackageName() + ".GYM_ENTER"; }
    static String actionOpen(Context ctx) { return ctx.getPackageName() + ".GYM_REMINDER_OPEN"; }

    private GymReminder() {}

    private static SharedPreferences prefs(Context ctx) {
        return ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    // ---------------------------------------------------------------- what is kept

    static void saveConfig(Context ctx, JSONObject config) {
        prefs(ctx).edit().putString("config", config.toString()).apply();
    }

    static JSONObject config(Context ctx) {
        try {
            String s = prefs(ctx).getString("config", null);
            return s == null ? null : new JSONObject(s);
        } catch (Exception e) {
            return null;
        }
    }

    static void saveStatus(Context ctx, JSONObject status) {
        prefs(ctx).edit().putString("status", status.toString()).apply();
    }

    static JSONObject status(Context ctx) {
        try {
            String s = prefs(ctx).getString("status", null);
            return s == null ? new JSONObject() : new JSONObject(s);
        } catch (Exception e) {
            return new JSONObject();
        }
    }

    // ---------------------------------------------------------------- permissions

    static boolean hasFine(Context ctx) {
        return ctx.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED;
    }

    /** Before Android 10 there is no separate background permission: the location one covers it. */
    static boolean hasBackground(Context ctx) {
        if (Build.VERSION.SDK_INT < 29) return hasFine(ctx);
        return ctx.checkSelfPermission(Manifest.permission.ACCESS_BACKGROUND_LOCATION) == PackageManager.PERMISSION_GRANTED;
    }

    // ---------------------------------------------------------------- watching

    private static PendingIntent alertIntent(Context ctx, int slot, String gymId, int flags) {
        Intent i = new Intent(ctx, GymReminderReceiver.class).setAction(actionEnter(ctx));
        if (gymId != null) i.putExtra("gym", gymId);
        // Mutable: the system adds KEY_PROXIMITY_ENTERING to it. Explicit, so nothing else can fill it in.
        int mutable = Build.VERSION.SDK_INT >= 31 ? PendingIntent.FLAG_MUTABLE : 0;
        return PendingIntent.getBroadcast(ctx, REQUEST_BASE + slot, i, flags | mutable);
    }

    /** Stops every alert this app may have registered. */
    static void unregister(Context ctx) {
        LocationManager lm = (LocationManager) ctx.getSystemService(Context.LOCATION_SERVICE);
        for (int slot = 0; slot < MAX_GYMS; slot++) {
            PendingIntent pi = alertIntent(ctx, slot, null, PendingIntent.FLAG_NO_CREATE);
            if (pi == null) continue;
            try {
                if (lm != null) lm.removeProximityAlert(pi);
            } catch (Exception ignored) {
                // no permission any more: the system dropped it already
            }
            pi.cancel();
        }
        prefs(ctx).edit().putInt("watching", 0).apply();
    }

    /**
     * Watches the saved gyms, or nothing when the reminder is off or location may not be used.
     * Returns how many gyms are watched.
     */
    static int register(Context ctx) {
        unregister(ctx);
        JSONObject c = config(ctx);
        if (c == null || !c.optBoolean("on", false) || !hasFine(ctx)) return 0;
        LocationManager lm = (LocationManager) ctx.getSystemService(Context.LOCATION_SERVICE);
        if (lm == null) return 0;
        JSONArray gyms = c.optJSONArray("gyms");
        int n = 0;
        for (int slot = 0; gyms != null && slot < gyms.length() && slot < MAX_GYMS; slot++) {
            JSONObject g = gyms.optJSONObject(slot);
            if (g == null) continue;
            double lat = g.optDouble("lat", Double.NaN), lng = g.optDouble("lng", Double.NaN);
            float radius = (float) Math.max(50, Math.min(500, g.optDouble("radius", 100)));
            if (Double.isNaN(lat) || Double.isNaN(lng)) continue;
            try {
                lm.addProximityAlert(lat, lng, radius, -1, alertIntent(ctx, slot, g.optString("id", ""), PendingIntent.FLAG_UPDATE_CURRENT));
                n++;
            } catch (SecurityException e) {
                break;
            }
        }
        prefs(ctx).edit().putInt("watching", n).putLong("armedAt", System.currentTimeMillis()).apply();
        return n;
    }

    static int watching(Context ctx) {
        return prefs(ctx).getInt("watching", 0);
    }

    // ---------------------------------------------------------------- arriving

    /** From GymReminderReceiver: a proximity alert fired. */
    static void onAlert(Context ctx, Intent intent) {
        if (!intent.getBooleanExtra(LocationManager.KEY_PROXIMITY_ENTERING, false)) return;
        SharedPreferences p = prefs(ctx);
        if (System.currentTimeMillis() - p.getLong("armedAt", 0) < ARM_GRACE_MS) return;
        arrive(ctx, intent.getStringExtra("gym"), Calendar.getInstance());
    }

    /** Applies the no-nag rule for arriving at `gymId` now, and posts if it says so. True if posted. */
    static boolean arrive(Context ctx, String gymId, Calendar now) {
        JSONObject c = config(ctx);
        if (c == null) return false;
        JSONObject st = status(ctx);
        JSONObject win = c.optJSONObject("window");
        JSONArray gyms = c.optJSONArray("gyms");
        SharedPreferences p = prefs(ctx);
        String why = GymReminderRules.skipReason(
                c.optBoolean("on", false), gyms == null ? 0 : gyms.length(),
                win == null ? null : win.optString("from", null), win == null ? null : win.optString("to", null),
                st.optString("trainedOn", ""), st.optString("quietOn", ""), st.optLong("activeSince", 0),
                p.getString("lastFired", ""), now);
        if (why != null) return false;
        JSONObject gym = null;
        for (int i = 0; gyms != null && i < gyms.length(); i++) {
            JSONObject g = gyms.optJSONObject(i);
            if (g != null && g.optString("id", "").equals(gymId)) gym = g;
        }
        String title = st.optString("title", "");
        String body = gym != null && !gym.optString("text", "").trim().isEmpty() ? gym.optString("text") : st.optString("body", "");
        if (title.isEmpty()) title = "Gym spotted";
        if (body.isEmpty()) body = "Ready for your workout? 💪";
        if (!post(ctx, title, body, st.optString("channel", ""))) return false;
        p.edit().putString("lastFired", GymReminderRules.isoOf(now)).apply();
        return true;
    }

    static boolean post(Context ctx, String title, String body, String channelName) {
        NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null || !nm.areNotificationsEnabled()) return false;
        if (Build.VERSION.SDK_INT >= 26 && nm.getNotificationChannel(CHANNEL_ID) == null) {
            NotificationChannel ch = new NotificationChannel(CHANNEL_ID, channelName.isEmpty() ? "Gym reminder" : channelName, NotificationManager.IMPORTANCE_DEFAULT);
            nm.createNotificationChannel(ch);
        }
        Intent open = new Intent(ctx, MainActivity.class).setAction(actionOpen(ctx));
        open.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_NEW_TASK);
        PendingIntent tap = PendingIntent.getActivity(ctx, NOTIFICATION_ID, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Notification.Builder b = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(ctx, CHANNEL_ID) : new Notification.Builder(ctx);
        b.setSmallIcon(R.drawable.ic_stat_dumbbell)
                .setContentTitle(title)
                .setContentText(body)
                .setStyle(new Notification.BigTextStyle().bigText(body))
                .setAutoCancel(true)
                .setShowWhen(true)
                .setWhen(System.currentTimeMillis())
                .setCategory(Notification.CATEGORY_REMINDER)
                .setContentIntent(tap);
        try {
            nm.notify(NOTIFICATION_ID, b.build());
            return true;
        } catch (Exception e) {
            return false;
        }
    }
}
