import type { ClientEvent } from '@/lib/metrics/events';
import type { Appointment } from '@/lib/metrics/calendar';

export type Reactivation = {
  pool_size: number;
  contacted: number;
  replied: number;
  rebooked: number;
  recovered_cents: number;
  dormancy_3_6mo: number;
  dormancy_6_12mo: number;
  dormancy_1_2yr: number;
  dormancy_2yr_plus: number;
};

export type ReactivationWin = {
  id: string;
  customer_name: string;
  dormant_months: number | null;
  won_cents: number | null;
  state: 'won' | 'replied';
};

export type Reputation = {
  jobs_done: number;
  rate_asks: number;
  rated_45: number;
  on_google: number;
  refer_asks: number;
  referrals_in: number;
  referrals_closed: number;
  referrals_lost: number;
  referral_revenue_cents: number;
  avg_rating: number | null;
};

export type Review = {
  id: string;
  rating: number;
  author: string | null;
  created_at: string;
};

export type Capability = {
  key: string;
  label: string;
  status: string;
};

export type Incident = {
  id: string;
  severity: 'warning' | 'critical';
  message: string;
  started_at: string;
  resolved_at: string | null;
};

export type DashData = {
  events: ClientEvent[];
  appointments: Appointment[];
  reactivation: Reactivation | null;
  wins: ReactivationWin[];
  reputation: Reputation | null;
  reviews: Review[];
  capabilities: Capability[];
  incidents: Incident[];
};
