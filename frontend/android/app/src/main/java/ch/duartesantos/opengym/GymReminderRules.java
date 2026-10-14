package ch.duartesantos.opengym;

import java.util.Calendar;
import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * The gym reminder's no-nag rule (#614), decided on the phone when a gym is entered, since the
 * page is not running then. The same rule as frontend lib/gym-reminder.js skipReason and
 * ios/App/GymReminderCore GymReminderRules.swift, in the same order; plain Java so the JVM unit
 * test can run it without Android.
 */
final class GymReminderRules {
    /** A running session older than this was never finished; it does not keep the reminder quiet. */
    static final long ACTIVE_FRESH_MS = 12L * 3600 * 1000;
    private static final Pattern TIME = Pattern.compile("^([01]\\d|2[0-3]):([0-5]\\d)$");

    private GymReminderRules() {}

    /** "HH:MM" as minutes after midnight, or -1. */
    static int minuteOf(String hhmm) {
        if (hhmm == null) return -1;
        Matcher m = TIME.matcher(hhmm);
        if (!m.matches()) return -1;
        return Integer.parseInt(m.group(1)) * 60 + Integer.parseInt(m.group(2));
    }

    /** No window (either end missing or invalid, or both the same) means any time; overnight wraps. */
    static boolean inWindow(String from, String to, int minuteOfDay) {
        int f = minuteOf(from), t = minuteOf(to);
        if (f < 0 || t < 0 || f == t) return true;
        return f < t ? minuteOfDay >= f && minuteOfDay < t : minuteOfDay >= f || minuteOfDay < t;
    }

    static String isoOf(Calendar c) {
        return String.format(Locale.ROOT, "%04d-%02d-%02d", c.get(Calendar.YEAR), c.get(Calendar.MONTH) + 1, c.get(Calendar.DAY_OF_MONTH));
    }

    /**
     * Why entering a gym now would not notify, or null when it should: off, fired (already today),
     * trained (a workout logged today), quiet (a day note excuses today), active (a session started
     * less than 12 hours ago), window (outside the time window).
     */
    static String skipReason(boolean on, int gyms, String windowFrom, String windowTo,
                             String trainedOn, String quietOn, long activeSince, String lastFired, Calendar now) {
        if (!on || gyms <= 0) return "off";
        String today = isoOf(now);
        if (today.equals(lastFired)) return "fired";
        if (today.equals(trainedOn)) return "trained";
        if (today.equals(quietOn)) return "quiet";
        if (activeSince > 0 && now.getTimeInMillis() - activeSince < ACTIVE_FRESH_MS) return "active";
        int minute = now.get(Calendar.HOUR_OF_DAY) * 60 + now.get(Calendar.MINUTE);
        if (!inWindow(windowFrom, windowTo, minute)) return "window";
        return null;
    }
}
