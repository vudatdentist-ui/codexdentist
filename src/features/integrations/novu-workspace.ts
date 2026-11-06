export type NovuDeliveryState = "RESERVED" | "ACCEPTED" | "UNCERTAIN" | "REJECTED" | "SENT";
export type NovuOperatorWorkspace = {
  subscriber: { subscriberId: string; verified: boolean } | null;
  deliveries: Array<{ id: string; state: NovuDeliveryState; synthetic: boolean }>;
};
