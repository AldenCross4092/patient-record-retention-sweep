import { z } from "zod";

export const AppointmentSchema = z.object({
  appointmentId: z.string().min(1),
  status: z.enum(["scheduled", "completed", "cancelled"]),
  updatedAt: z.string().datetime(),
  storageKeys: z.array(z.string().min(1)).max(20),
});

export const SweepRequestSchema = z.object({
  appointments: z.array(AppointmentSchema).max(500).default([]),
  asOf: z.string().datetime().optional(),
  retentionDays: z.number().int().min(30).max(3650).default(365),
});

export type SweepRequest = z.infer<typeof SweepRequestSchema>;

export type SweepDecision = {
  reviewed: number;
  staleAppointmentIds: string[];
  storageKeys: string[];
  notification: {
    category: "retention_sweep_completed";
    deletedRecordCount: number;
    message: string;
  };
};

export function decideRetentionSweep(input: SweepRequest): SweepDecision {
  const asOf = new Date(input.asOf ?? new Date().toISOString()).getTime();
  const cutoff = asOf - input.retentionDays * 24 * 60 * 60 * 1_000;
  const stale = input.appointments.filter((appointment) =>
    appointment.status !== "scheduled" && new Date(appointment.updatedAt).getTime() < cutoff,
  );
  const storageKeys = [...new Set(stale.flatMap((appointment) => appointment.storageKeys))];

  return {
    reviewed: input.appointments.length,
    staleAppointmentIds: stale.map((appointment) => appointment.appointmentId),
    storageKeys,
    notification: {
      category: "retention_sweep_completed",
      deletedRecordCount: stale.length,
      message: `${stale.length} expired appointment record(s) selected by retention policy`,
    },
  };
}
