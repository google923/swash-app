// weekly-overview.js - Weekly overview bar for tracking unpaid/uncompleted jobs
// Shows summary per week with live Firestore updates and quick action buttons

export function createWeeklyOverviewModule({ db, auth }) {
  const overviewCache = new Map(); // Cache: weekKey -> { unsubscribe, stats }
  
  /**
   * Generate week key for caching/aggregation
   * Format: "2025-11-10" (ISO date of Monday of that week)
   */
  function getWeekKey(date) {
    const d = new Date(date);
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Adjust to Monday
    const monday = new Date(d.setDate(diff));
    return monday.toISOString().split('T')[0];
  }

  /**
   * Subscribe to weekly job statistics
   * Watches jobs for a given week and aggregates unpaid/uncompleted counts
   */
  function subscribeToWeeklyStats(weekStart, onStatsUpdate) {
    const {
      collection,
      query,
      where,
      onSnapshot,
      Timestamp,
    } = window.firebase.firestore;

    const weekKey = getWeekKey(weekStart);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 7);

    const jobsRef = collection(db, 'jobs');
    const jobsQuery = query(
      jobsRef,
      where('date', '>=', Timestamp.fromDate(weekStart)),
      where('date', '<', Timestamp.fromDate(weekEnd))
    );

    console.log(`[WeeklyOverview] Subscribing to jobs for week ${weekKey}`);

    const unsubscribe = onSnapshot(
      jobsQuery,
      (snapshot) => {
        const jobs = snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        }));

        const stats = {
          total: jobs.length,
          unpaid: jobs.filter(j => !j.paid).length,
          uncompleted: jobs.filter(j => j.status !== 'completed').length,
          jobs: jobs,
          weekStart: weekStart,
          weekKey: weekKey,
        };

        console.log(`[WeeklyOverview] Week ${weekKey} stats:`, stats);
        onStatsUpdate(stats);
      },
      (error) => {
        console.error(`[WeeklyOverview] Failed to subscribe to weekly stats for ${weekKey}:`, error);
      }
    );

    return unsubscribe;
  }

  /**
   * Mark a job as paid
   */
  async function markJobAsPaid(jobId) {
    const { doc, updateDoc } = window.firebase.firestore;
    try {
      console.log(`[WeeklyOverview] Marking job ${jobId} as paid`);
      await updateDoc(doc(db, 'jobs', jobId), {
        paid: true,
        paidAt: new Date(),
      });
      console.log(`[WeeklyOverview] Job ${jobId} marked as paid`);
      return true;
    } catch (error) {
      console.error(`[WeeklyOverview] Failed to mark job ${jobId} as paid:`, error);
      return false;
    }
  }

  /**
   * Mark a job as completed
   */
  async function markJobAsCompleted(jobId) {
    const { doc, updateDoc } = window.firebase.firestore;
    try {
      console.log(`[WeeklyOverview] Marking job ${jobId} as completed`);
      await updateDoc(doc(db, 'jobs', jobId), {
        status: 'completed',
        completedAt: new Date(),
      });
      console.log(`[WeeklyOverview] Job ${jobId} marked as completed`);
      return true;
    } catch (error) {
      console.error(`[WeeklyOverview] Failed to mark job ${jobId} as completed:`, error);
      return false;
    }
  }

  return {
    subscribeToWeeklyStats,
    markJobAsPaid,
    markJobAsCompleted,
    getWeekKey,
  };
}
