package ch.duartesantos.opengym;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import java.util.Calendar;
import org.junit.Test;

/** The no-nag rule, case for case the same as frontend src/lib/gym-reminder.test.js. */
public class GymReminderRulesTest {
    private static Calendar at(int h, int m) {
        Calendar c = Calendar.getInstance();
        c.clear();
        c.set(2026, Calendar.OCTOBER, 15, h, m, 0);
        return c;
    }

    private static String reason(boolean on, int gyms, String from, String to, String trained, String quiet, long active, String fired, Calendar now) {
        return GymReminderRules.skipReason(on, gyms, from, to, trained, quiet, active, fired, now);
    }

    @Test
    public void goesOffOnANormalDay() {
        assertNull(reason(true, 1, null, null, "2026-10-14", "", 0, "", at(18, 0)));
    }

    @Test
    public void offOrNoGym() {
        assertEquals("off", reason(false, 1, null, null, "", "", 0, "", at(18, 0)));
        assertEquals("off", reason(true, 0, null, null, "", "", 0, "", at(18, 0)));
    }

    @Test
    public void onceADay() {
        assertEquals("fired", reason(true, 1, null, null, "", "", 0, "2026-10-15", at(18, 0)));
        assertNull(reason(true, 1, null, null, "", "", 0, "2026-10-14", at(18, 0)));
    }

    @Test
    public void notAfterTrainingNorOnAnExcusedDay() {
        assertEquals("trained", reason(true, 1, null, null, "2026-10-15", "", 0, "", at(18, 0)));
        assertEquals("quiet", reason(true, 1, null, null, "", "2026-10-15", 0, "", at(18, 0)));
    }

    @Test
    public void notWhileAWorkoutRuns() {
        Calendar now = at(18, 0);
        assertEquals("active", reason(true, 1, null, null, "", "", now.getTimeInMillis() - 3_600_000L, "", now));
        assertNull(reason(true, 1, null, null, "", "", now.getTimeInMillis() - 13 * 3_600_000L, "", now));
    }

    @Test
    public void timeWindowAlsoOvernight() {
        assertEquals("window", reason(true, 1, "06:00", "12:00", "", "", 0, "", at(18, 0)));
        assertNull(reason(true, 1, "06:00", "12:00", "", "", 0, "", at(7, 0)));
        assertTrue(GymReminderRules.inWindow("22:00", "02:00", 23 * 60 + 30));
        assertTrue(GymReminderRules.inWindow("22:00", "02:00", 90));
        assertFalse(GymReminderRules.inWindow("22:00", "02:00", 12 * 60));
        assertTrue(GymReminderRules.inWindow("06:00", "06:00", 3 * 60));
        assertTrue(GymReminderRules.inWindow("6:00", "22:00", 3 * 60));
        assertFalse(GymReminderRules.inWindow("06:00", "22:00", 22 * 60));
    }

    @Test
    public void isoDate() {
        assertEquals("2026-10-15", GymReminderRules.isoOf(at(0, 0)));
        assertEquals(-1, GymReminderRules.minuteOf("24:00"));
        assertEquals(6 * 60 + 5, GymReminderRules.minuteOf("06:05"));
    }
}
