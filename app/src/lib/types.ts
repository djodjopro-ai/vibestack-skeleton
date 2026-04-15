import type { ComponentType, SVGProps } from "react";

export interface User {
  id: string;
  name: string;
  email: string | null;
  language: string | null;
  timezone: string | null;
  onboardingComplete: boolean;
  telegramChatId?: string | null;
  telegramUsername?: string | null;
  subscriptionTier?: "free" | "pro";
  subscriptionStatus?: "none" | "active" | "canceled" | "past_due";
  subscriptionRenewsAt?: number | null;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  timestamp: number;
}

export type IconType = ComponentType<SVGProps<SVGSVGElement>>;

export interface SectionConfig {
  id: string;
  label: string;
  icon: IconType;
  render: () => React.ReactNode;
  badge?: () => number | null;
}

// Domain plugins extend this via module augmentation if they want typed content.
export type DomainContent = Record<string, unknown>;
