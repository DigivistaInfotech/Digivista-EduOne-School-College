import type { Permission } from "@erp/shared";
import { INDIA_STATES } from "@erp/shared/regional";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { Link, Navigate, NavLink, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { AsterleafBrand } from "./AsterleafLogo";
import { cn, Icon } from "./ui";
import { roleLabel } from "../lib/format";
import { useLanguage } from "../auth/LanguageContext";
import { getRegionalSettings } from "../lib/endpoints";
import { IndiaFlag } from "./IndiaFlag";
import { AccessChecker } from "./AccessChecker";
import { NAV_SECTIONS } from "../lib/navigation";

export function AppShell(): ReactNode {
  const { user, membership, memberships, logout, setActiveSchool } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [navigationSearch, setNavigationSearch] = useState("");
  const desktopNavigationSearchRef = useRef<HTMLInputElement>(null);
  const mobileNavigationSearchRef = useRef<HTMLInputElement>(null);
  const location = useLocation();
  const { t, language, choice, setChoice } = useLanguage();
  const regional = useQuery({
    queryKey: ["regional-settings", membership?.schoolId],
    queryFn: () => getRegionalSettings(membership!.schoolId),
    enabled: !!membership,
  });
  const state = INDIA_STATES.find(
    (entry) => entry.code === regional.data?.settings.stateCode,
  );

  useEffect(() => {
    function handleNavigationShortcut(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        (mobileOpen ? mobileNavigationSearchRef : desktopNavigationSearchRef).current?.focus();
      }
      if (event.key === "Escape" && (document.activeElement === desktopNavigationSearchRef.current || document.activeElement === mobileNavigationSearchRef.current)) {
        setNavigationSearch("");
        (document.activeElement as HTMLElement | null)?.blur();
      }
    }
    window.addEventListener("keydown", handleNavigationShortcut);
    return () => window.removeEventListener("keydown", handleNavigationShortcut);
  }, [mobileOpen]);

  useEffect(() => {
    setNavigationSearch("");
  }, [location.pathname]);

  if (!membership || !user) return <Navigate to="/login" replace />;

  const visibleSections = NAV_SECTIONS.map((section) => ({
    ...section,
    items: section.items.filter(
      (item) =>
        (item.permission
          ? membership.permissions.includes(item.permission)
          : true) &&
        (item.anyPermission
          ? item.anyPermission.some((permission) =>
              membership.permissions.includes(permission),
            )
            : true) &&
        (!navigationSearch.trim() ||
          `${t(section.heading)} ${t(section.description)} ${t(item.label)} ${item.to}`
            .toLocaleLowerCase()
            .includes(navigationSearch.trim().toLocaleLowerCase())),
    ),
  })).filter((section) => section.items.length > 0);

  const renderNavigation = (searchId: string, searchRef: RefObject<HTMLInputElement | null>) => (
    <nav className="scroll-thin flex-1 space-y-4 overflow-y-auto px-3 py-4" aria-label="Main navigation">
      <div className="sticky top-0 z-10 rounded-xl bg-[#182944] pb-2">
        <label htmlFor={searchId} className="sr-only">Search menu</label>
        <div className="relative">
          <Icon name="search" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/55" />
          <input
            ref={searchRef}
            id={searchId}
            type="search"
            value={navigationSearch}
            onChange={(event) => setNavigationSearch(event.target.value)}
            placeholder="Find a page…"
            autoComplete="off"
            className="min-h-10 w-full rounded-xl border border-white/15 bg-white/8 py-2 pl-9 pr-12 text-xs font-medium text-white placeholder:text-white/50 focus:border-[#45c7bc] focus:outline-hidden focus:ring-2 focus:ring-[#45c7bc]/30"
          />
          <kbd className="absolute right-2 top-1/2 -translate-y-1/2 rounded border border-white/15 px-1.5 py-0.5 text-[9px] text-white/55">Ctrl K</kbd>
        </div>
        {navigationSearch.trim() && (
          <p className="px-2 pt-1.5 text-[10px] text-white/55" aria-live="polite">
            {visibleSections.reduce((count, section) => count + section.items.length, 0)} matching pages
          </p>
        )}
      </div>
      {visibleSections.map((section) => (
        <div key={section.heading} className="border-t border-white/10 pt-3 first:border-t-0 first:pt-0">
          <p className="mb-1.5 flex items-center justify-between gap-2 px-3 text-[10px] font-extrabold tracking-[0.12em] uppercase text-white/60">
            {t(section.heading)}
            <span className="rounded-full bg-white/8 px-1.5 py-0.5 text-[9px] font-bold tracking-normal text-white/45">{section.items.length}</span>
          </p>
          <p className="mb-2 px-3 text-[10px] leading-4 text-white/40">{t(section.description)}</p>
          <ul className="space-y-1">
            {section.items.map((item) => (
              <li key={item.to}>
                <NavLink
                  to={item.to}
                  end={item.end}
                  onClick={() => setMobileOpen(false)}
                  className={({ isActive }) =>
                    cn(
                      "group flex items-center gap-2.5 rounded-xl px-3 py-2 text-xs font-semibold transition min-h-[38px]",
                      isActive
                        ? "bg-[#087F83] text-white shadow-xs font-bold"
                        : "text-white/80 hover:bg-white/10 hover:text-white",
                    )
                  }
                >
                  <Icon
                    name={item.icon}
                    className="h-4 w-4 shrink-0"
                    strokeWidth={2}
                  />
                  <span className="truncate">{t(item.label)}</span>
                </NavLink>
              </li>
            ))}
          </ul>
        </div>
      ))}
      {visibleSections.length === 0 && (
        <div className="rounded-xl border border-dashed border-white/20 px-3 py-4 text-center text-xs text-white/65">
          No menu pages match “{navigationSearch}”. Try a shorter search.
        </div>
      )}
    </nav>
  );

  return (
    <div className="min-h-screen bg-[#F3F6FA] text-[#182944]">
      {/* Desktop sidebar with Midnight background (#182944) */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col bg-[#182944] text-white lg:flex">
        <BrandHeader />
        {renderNavigation("desktop-navigation-search", desktopNavigationSearchRef)}
        <div className="border-t border-white/10 p-3">
          <SchoolSwitcher
            memberships={memberships}
            activeSchoolId={membership.schoolId}
            onChange={setActiveSchool}
          />
        </div>
      </aside>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button
            type="button"
            aria-label="Close navigation"
            className="absolute inset-0 bg-[#182944]/70 backdrop-blur-xs"
            onClick={() => setMobileOpen(false)}
          />
          <aside className="relative flex h-full w-72 flex-col bg-[#182944] text-white shadow-2xl">
            <BrandHeader />
            {renderNavigation("mobile-navigation-search", mobileNavigationSearchRef)}
            <div className="border-t border-white/10 p-3">
              <SchoolSwitcher
                memberships={memberships}
                activeSchoolId={membership.schoolId}
                onChange={(id) => {
                  setActiveSchool(id);
                  setMobileOpen(false);
                }}
              />
            </div>
          </aside>
        </div>
      )}

      {/* Main container */}
      <div className="lg:pl-64">
        {/* Sticky top header */}
        <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 backdrop-blur-md">
          <div className="h-1 bg-gradient-to-r from-[#182944] via-[#087F83] to-[#7654C7]" />
          <div className="flex h-15 items-center justify-between gap-3 px-4 sm:px-6">
            <div className="flex items-center gap-3 min-w-0">
              <button
                type="button"
                className="rounded-xl p-2 text-slate-700 hover:bg-slate-100 lg:hidden min-h-[44px] min-w-[44px] flex items-center justify-center"
                onClick={() => setMobileOpen(true)}
                aria-label="Open navigation"
              >
                <Icon name="menu" className="h-5 w-5" />
              </button>

              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h2 className="truncate text-sm font-extrabold text-[#182944]">
                    {membership.schoolName}
                  </h2>
                  <span className="hidden md:inline-flex rounded-full bg-[#DDF4EC] px-2 py-0.5 text-[10px] font-bold text-[#087F83]">
                    Nursery - XII
                  </span>
                </div>
                <p className="truncate text-xs font-semibold text-slate-500">
                  {membership.roles.map(roleLabel).join(" · ") ||
                    "No role assigned"}{" "}
                  · 2026-27 Session
                </p>
              </div>
            </div>

            {/* Quick shortcuts and user profile menu */}
            <div className="flex items-center gap-2 sm:gap-3">
              {(membership.permissions.includes("access.roles.manage") || membership.permissions.includes("access.roles.inspect")) && (
                <AccessChecker />
              )}
              <Link
                to="/modules"
                className="hidden sm:inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-bold text-slate-700 hover:border-[#087F83] hover:text-[#087F83] transition min-h-[38px]"
              >
                <Icon name="layers" className="h-3.5 w-3.5" />
                <span>30 Modules</span>
              </Link>

              <Link
                to="/pain-points"
                className="hidden md:inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-bold text-slate-700 hover:border-[#087F83] hover:text-[#087F83] transition min-h-[38px]"
              >
                <Icon name="alert" className="h-3.5 w-3.5 text-amber-500" />
                <span>Pain Points</span>
              </Link>

              <div className="relative">
                <button
                  type="button"
                  onClick={() => setMenuOpen((open) => !open)}
                  className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-white py-1 pr-3 pl-1.5 text-sm font-bold text-[#182944] transition hover:border-[#087F83] min-h-[44px]"
                  aria-haspopup="menu"
                  aria-expanded={menuOpen}
                >
                  <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-[#087F83] text-xs font-extrabold text-white">
                    {initials(user.displayName)}
                  </span>
                  <span className="hidden max-w-36 truncate sm:block text-xs font-bold">
                    {user.displayName}
                  </span>
                </button>

                {menuOpen && (
                  <>
                    <button
                      type="button"
                      aria-label="Close menu"
                      className="fixed inset-0 z-10 cursor-default"
                      onClick={() => setMenuOpen(false)}
                    />
                    <div
                      role="menu"
                      className="absolute right-0 z-20 mt-2 w-64 rounded-2xl border border-slate-200 bg-white py-1.5 shadow-lg"
                    >
                      <div className="border-b border-slate-100 px-4 py-2.5">
                        <p className="truncate text-xs font-bold text-[#182944]">
                          {user.displayName}
                        </p>
                        <p className="truncate text-[11px] text-slate-500">
                          {user.email}
                        </p>
                      </div>

                      <NavLink
                        to="/profile"
                        onClick={() => setMenuOpen(false)}
                        className="flex items-center gap-2 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 hover:text-[#087F83]"
                        role="menuitem"
                      >
                        <Icon name="user" className="h-4 w-4" />
                        Profile & security
                      </NavLink>

                      <NavLink
                        to="/modules"
                        onClick={() => setMenuOpen(false)}
                        className="flex items-center gap-2 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 hover:text-[#087F83]"
                        role="menuitem"
                      >
                        <Icon name="layers" className="h-4 w-4" />
                        30 Module Cards
                      </NavLink>

                      <NavLink
                        to="/pain-points"
                        onClick={() => setMenuOpen(false)}
                        className="flex items-center gap-2 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 hover:text-[#087F83]"
                        role="menuitem"
                      >
                        <Icon name="alert" className="h-4 w-4" />
                        20-Year Pain Points
                      </NavLink>

                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setMenuOpen(false);
                          void logout();
                        }}
                        className="flex w-full items-center gap-2 px-4 py-2 text-left text-xs font-semibold text-rose-600 hover:bg-rose-50"
                      >
                        <Icon name="logout" className="h-4 w-4" />
                        Sign out
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        </header>

        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-white px-4 py-2 sm:px-6">
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-600">
            <IndiaFlag className="h-4 w-6 rounded-sm shadow-sm" />
            <span>
              {t("India")} ·{" "}
              {state
                ? language === "hi"
                  ? state.nameHi
                  : state.name
                : t("State not selected")}
            </span>
            <Link
              to="/config-studio"
              className="rounded px-2 py-1 text-[#087F83] hover:bg-slate-100"
              aria-label={t("Open school setup")}
            >
              {t("School location & language")}
            </Link>
          </div>
          <div className="flex items-center gap-2">
            <label
              htmlFor="interface-language"
              className="text-xs font-semibold text-slate-500"
            >
              {t("Interface language")}
            </label>
            <select
              id="interface-language"
              className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs"
              value={choice}
              onChange={(event) =>
                setChoice(
                  event.target.value === "hi"
                    ? "hi"
                    : event.target.value === "en"
                      ? "en"
                      : "school",
                )
              }
            >
              <option value="school">{t("Use school language")}</option>
              <option value="en">English</option>
              <option value="hi">हिन्दी</option>
            </select>
          </div>
        </div>

        {/* Content area */}
        <main className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
          <Outlet />
        </main>
      </div>

      <span className="sr-only" aria-live="polite">
        {location.pathname}
      </span>
    </div>
  );
}

function BrandHeader(): ReactNode {
  return (
    <div className="flex h-16 items-center border-b border-white/10 px-4">
      <Link to="/" className="w-full">
        <AsterleafBrand inverted={true} showTagline={true} />
      </Link>
    </div>
  );
}

function SchoolSwitcher({
  memberships,
  activeSchoolId,
  onChange,
}: {
  memberships: Array<{
    schoolId: string;
    schoolName: string;
    schoolCode: string;
  }>;
  activeSchoolId: string;
  onChange: (schoolId: string) => void;
}): ReactNode {
  if (memberships.length <= 1) {
    const current = memberships[0];
    return (
      <div className="rounded-xl bg-white/5 px-3 py-2 border border-white/10">
        <p className="text-[10px] font-bold tracking-[0.16em] text-[#087F83] uppercase">
          DIGI
        </p>
        <p className="truncate text-xs font-bold text-white">
          {current?.schoolName ?? "School ERP"}
        </p>
      </div>
    );
  }

  return (
    <label className="block">
      <span className="mb-1 block text-[10px] font-bold tracking-[0.16em] text-[#087F83] uppercase">
        Campus Switcher
      </span>
      <select
        className="field-input !py-1.5 !text-xs !bg-white/10 !border-white/20 !text-white"
        value={activeSchoolId}
        onChange={(event) => onChange(event.target.value)}
      >
        {memberships.map((entry) => (
          <option
            key={entry.schoolId}
            value={entry.schoolId}
            className="text-[#182944]"
          >
            {entry.schoolName}
          </option>
        ))}
      </select>
    </label>
  );
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

export function RequirePermission({
  permission,
  children,
}: {
  permission: Permission;
  children: ReactNode;
}): ReactNode {
  const { can } = useAuth();
  if (!can(permission)) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-xs">
        <p className="text-sm font-bold text-[#182944]">Access denied</p>
        <p className="mt-1 text-xs text-slate-500">
          Your role does not include this area. Ask a school administrator if
          you need access.
        </p>
      </div>
    );
  }
  return children;
}

export function RequireAnyPermission({
  permissions,
  children,
}: {
  permissions: Permission[];
  children: ReactNode;
}): ReactNode {
  const { can } = useAuth();
  if (!permissions.some((permission) => can(permission))) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-xs">
        <p className="text-sm font-bold text-[#182944]">Access denied</p>
        <p className="mt-1 text-xs text-slate-500">
          Your role does not include this area. Ask a school administrator if
          you need access.
        </p>
      </div>
    );
  }
  return children;
}
