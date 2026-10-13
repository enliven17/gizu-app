export type EarlyAccessSignup = {
  email: string;
  investmentRange?: string;
  platforms?: string[];
  otherPlatform?: string;
};

export interface EarlyAccess {
  add(signup: EarlyAccessSignup): Promise<void>;
}
