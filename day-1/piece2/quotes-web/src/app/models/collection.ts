export interface CollectionSummary {
  id: number;
  name: string;
  ownerId: number;
  itemCount: number;
  lastAddedAt: string | null;
}

export interface CollectionDetailItem {
  quoteId: number;
  author: string;
  text: string;
  addedAt: string;
}

export interface CollectionDetail {
  id: number;
  name: string;
  ownerId: number;
  items: CollectionDetailItem[];
}
