export type NotificationItem = {
  id: string;
  title: string;
  body: string;
  time: string;
  category: "order" | "vault" | "report" | "security";
  read: boolean;
};
export interface NotificationService {
  load(): Promise<NotificationItem[]>;
  setRead(ids: string[], read: boolean): Promise<void>;
}
// Static inbox, not evidence of a current trade, credential or available document.
export const notificationFixture: NotificationItem[] = [
  {
    id: "n1",
    title: "Order update",
    body: "Review your order history in Activity.",
    time: "14:02",
    category: "order",
    read: false,
  },
  {
    id: "n2",
    title: "Vertex Quant",
    body: "Explore the vault strategy, allocation and redemption terms before placing an order.",
    time: "11:20",
    category: "vault",
    read: false,
  },
  {
    id: "n3",
    title: "Statement preferences",
    body: "Choose your preferred statement frequency in Account. Document delivery is not available yet.",
    time: "Yesterday",
    category: "report",
    read: true,
  },
  {
    id: "n4",
    title: "Account security",
    body: "Keep your device secure. Passkey registration and recovery are not available yet.",
    time: "Yesterday",
    category: "security",
    read: true,
  },
];
/** Native wallet inbox: no notification source is integrated yet, so it is empty. */
export const emptyNotificationService: NotificationService = {
  async load() {
    return [];
  },
  async setRead() {},
};

export function createMockNotificationService(seed = notificationFixture): NotificationService {
  let items = seed.map((item) => ({ ...item }));
  return {
    async load() {
      return items.map((item) => ({ ...item }));
    },
    async setRead(ids, read) {
      items = items.map((item) => (ids.includes(item.id) ? { ...item, read } : item));
    },
  };
}
