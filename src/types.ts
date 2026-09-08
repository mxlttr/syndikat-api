export interface MetrixTournament {
  0: string; // event id
  1: string; // title with arrow
  2: number; // latitude
  3: number; // longitude
  4: string; // start date
  7: string; // location with arrow
}

export interface OfficialTournament {
  event_id: number;
  event_name: string;
  location_latitude: string;
  location_longitude: string;
  location: string;
  num_attendees: number;
  spots: number;
  status: number;
  timestamp_end: number;
  timestamp_registration_phase: number;
  timestamp_start: number;
  title_picture_path: string;
  website_external: string;
}

export interface RelatedTournament {
  id: number;
  round: string;
}

export interface TournamentOutput {
  title: string;
  link: string;
  location: string;
  station?: string;
  coords: {
    lat: number | null;
    lng: number | null;
  };
  badge?: string;
  dates: {
    startTournament: string | Date | null;
    endTournament?: string | Date | null;
    startRegistration?: string | Date | null;
  };
  spots?: {
    overall: number;
    used: number;
  };
  round?: string;
  event_id?: number;
  relatedTournaments?: RelatedTournament[];
}

export interface TournamentPlayer {
  waitlisted: boolean;
  pdga_id: number | null;
  name: string;
}

export interface TournamentWithPlayers extends TournamentOutput {
  event_id: number;
  our_players: TournamentPlayer[];
}

export interface Rating {
  firstName: string;
  lastName: string;
  rating: number;
  ratingChange: 1 | -1 | null;
  divisionCount: number;
  gtNumber: number;
  division: string;
  lastRound: Date;
  roundCount: number;
  dmRounds: number;
  rank: number;
  divisionRank: number;
  link: string;
  club: string;
}
