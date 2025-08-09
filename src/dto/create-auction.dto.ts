export class CreateAuctionDto {
  carId: string;        // e.g. "car-new-001"
  minutes?: number;     // default 30
  startingBid?: number; // default 1000
}
