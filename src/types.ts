export interface WatchedDateDoc {
  date: string;
  users: string[];
  lastStatus: string | null;
}

export interface UserDoc {
  dates: string[];
}

export interface ScrapedDateStatus {
  date: string;
  status: string;
}

export interface StatusChange {
  date: string;
  oldStatus: string | null;
  newStatus: string;
  users: string[];
}
