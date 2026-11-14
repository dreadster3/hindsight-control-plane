// @vitest-environment jsdom
/**
 * The header logout must appear in BOTH auth modes. It originally rendered only
 * for access-key deployments, leaving OIDC users (whose whole session is the
 * per-user bank scope) with no way to sign out from the UI.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("next-intl", () => ({
  useTranslations: () => {
    const t = (key: string) => key;
    t.rich = (key: string) => key;
    return t;
  },
}));

vi.mock("next/image", () => ({ default: () => null }));

let features: Record<string, boolean> = {};
vi.mock("@/lib/features-context", () => ({
  useFeatures: () => ({ features, loading: false, error: null }),
}));

vi.mock("@/lib/bank-context", () => ({
  BANKS_PAGE_SIZE: 50,
  useBank: () => ({
    currentBank: null,
    setCurrentBank: vi.fn(),
    bankInfos: [],
    banksLoading: false,
    banksLoadingMore: false,
    hasMoreBanks: false,
    bankSearch: "",
    currentBankName: null,
    searchBanks: vi.fn(),
    loadBanks: vi.fn(),
    loadMoreBanks: vi.fn(),
  }),
}));

vi.mock("@/lib/theme-context", () => ({
  useTheme: () => ({ theme: "light", toggleTheme: vi.fn() }),
}));

vi.mock("@/lib/api", () => ({
  client: {
    getVersion: () => Promise.resolve({ features: { file_upload_api: false } }),
  },
}));

vi.mock("@/components/language-switcher", () => ({
  LanguageSwitcher: () => null,
  useSwitchLocale: () => ({ locale: "en", switchLocale: vi.fn() }),
}));

vi.mock("@/components/sidebar", () => ({ SidebarMenuButton: () => null }));
vi.mock("@/components/bank-kind-switch", () => ({ BankKindSwitch: () => null }));
vi.mock("@/components/knowledge-banks-list", () => ({ CreateKnowledgeBankDialog: () => null }));
vi.mock("@/components/content-composer", () => ({
  ContentComposer: () => null,
  hasComposedContent: () => false,
  toRetainContent: () => [],
}));

vi.mock("@/lib/knowledge-banks", () => ({
  KNOWLEDGE_UPLOAD_EVENT: "hindsight:knowledge-upload",
  knowledgeBankRoute: (id: string) => `/knowledge-banks/${id}`,
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const fetchMock = vi.fn().mockResolvedValue({ ok: true });
vi.stubGlobal("fetch", fetchMock);
// jsdom's location is unforgeable; a plain stub lets us assert the redirect.
vi.stubGlobal("location", { href: "" });

const { BankSelector } = await import("@/components/bank-selector");

afterEach(() => {
  cleanup();
  fetchMock.mockClear();
});

describe("header logout button", () => {
  it("shows for OIDC sessions (access_key_auth off)", () => {
    features = { oidc_auth: true, access_key_auth: false };
    render(<BankSelector />);
    expect(screen.getByTitle("logout")).toBeTruthy();
  });

  it("still shows for legacy access-key deployments", () => {
    features = { oidc_auth: false, access_key_auth: true };
    render(<BankSelector />);
    expect(screen.getByTitle("logout")).toBeTruthy();
  });

  it("is hidden when no auth mode is enabled", () => {
    features = { oidc_auth: false, access_key_auth: false };
    render(<BankSelector />);
    expect(screen.queryByTitle("logout")).toBeNull();
  });

  it("posts to the logout route and returns to the login page", async () => {
    features = { oidc_auth: true, access_key_auth: false };
    render(<BankSelector />);
    fireEvent.click(screen.getByTitle("logout"));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith("/api/auth/logout", { method: "POST" })
    );
    expect(window.location.href).toBe("/login");
  });
});