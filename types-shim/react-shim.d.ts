/**
 * SANDBOX-ONLY React type shim.
 *
 * The delivery environment has no npm registry access, so @types/react
 * cannot be installed there. This shim types the React surface this
 * codebase actually uses so `tsc -p tsconfig.sandbox.json` can strictly
 * check all application code (props, state, services, logic).
 *
 * Trade-off (documented in docs/test-report.md): intrinsic DOM elements
 * accept loosely-typed attributes here. On a normal machine,
 * `npm install && npm run typecheck` uses the REAL @types/react from
 * devDependencies — this file is not included by the default tsconfig.
 */

declare module "react" {
  export type Key = string | number;
  export type ReactNode =
    | ReactElement
    | string
    | number
    | boolean
    | null
    | undefined
    | Iterable<ReactNode>;

  export interface ReactElement {
    type: unknown;
    props: unknown;
    key: Key | null;
  }

  export type CSSProperties = Record<string, string | number | undefined>;

  export interface SyntheticEvent<T = Element> {
    target: EventTarget & T;
    currentTarget: EventTarget & T;
    preventDefault(): void;
    stopPropagation(): void;
    defaultPrevented: boolean;
  }
  export interface FormEvent<T = Element> extends SyntheticEvent<T> {}
  export interface ChangeEvent<T = Element> extends SyntheticEvent<T> {}
  export interface MouseEvent<T = Element> extends SyntheticEvent<T> {
    button: number;
    metaKey: boolean;
    ctrlKey: boolean;
    shiftKey: boolean;
    altKey: boolean;
  }
  export interface KeyboardEvent<T = Element> extends SyntheticEvent<T> {
    key: string;
    shiftKey: boolean;
  }

  export interface HTMLProps {
    [attr: string]: unknown;
    children?: ReactNode;
    className?: string;
    style?: CSSProperties;
    // Typed handlers so inline arrow-function params infer correctly.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onChange?: (e: ChangeEvent<any>) => void;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onClick?: (e: MouseEvent<any>) => void;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onSubmit?: (e: FormEvent<any>) => void;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onKeyDown?: (e: KeyboardEvent<any>) => void;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onBlur?: (e: SyntheticEvent<any>) => void;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onFocus?: (e: SyntheticEvent<any>) => void;
  }
  export type AnchorHTMLAttributes<T> = HTMLProps & { href?: string; target?: string; rel?: string; onClick?: (e: MouseEvent<T>) => void };
  export type SVGProps<T> = HTMLProps & { size?: number; width?: number | string; height?: number | string; viewBox?: string; fill?: string; stroke?: string; strokeWidth?: number | string; strokeLinecap?: string; strokeLinejoin?: string; "aria-hidden"?: boolean };

  export interface Context<T> {
    Provider: (props: { value: T; children?: ReactNode }) => ReactElement;
    Consumer: (props: { children: (value: T) => ReactNode }) => ReactElement;
  }
  export function createContext<T>(defaultValue: T): Context<T>;
  export function useContext<T>(ctx: Context<T>): T;

  export function useState<S>(initial: S | (() => S)): [S, (next: S | ((prev: S) => S)) => void];
  export function useState<S = undefined>(): [S | undefined, (next: S | undefined | ((prev: S | undefined) => S | undefined)) => void];
  export function useEffect(effect: () => void | (() => void), deps?: readonly unknown[]): void;
  export function useMemo<T>(factory: () => T, deps: readonly unknown[]): T;
  export function useCallback<T extends (...args: never[]) => unknown>(fn: T, deps: readonly unknown[]): T;
  export interface MutableRefObject<T> {
    current: T;
  }
  export function useRef<T>(initial: T): MutableRefObject<T>;
  export function useRef<T>(initial: T | null): { current: T | null };
  export function useRef<T = undefined>(): MutableRefObject<T | undefined>;

  export const StrictMode: (props: { children?: ReactNode }) => ReactElement;
  export const Fragment: (props: { children?: ReactNode }) => ReactElement;

  export interface ErrorInfo {
    componentStack?: string | null;
  }

  export abstract class Component<P = Record<string, never>, S = Record<string, never>> {
    constructor(props: P);
    props: P;
    state: S;
    setState(state: Partial<S>): void;
    render(): ReactNode;
  }

  const React: {
    createElement: (...args: unknown[]) => ReactElement;
  };
  export default React;

  // Namespace mirror so `React.FormEvent` style references type-check.
  global {
    namespace React {
      type ReactNode = import("react").ReactNode;
      type CSSProperties = import("react").CSSProperties;
      type FormEvent<T = Element> = import("react").FormEvent<T>;
      type ChangeEvent<T = Element> = import("react").ChangeEvent<T>;
      type MouseEvent<T = Element> = import("react").MouseEvent<T>;
      type KeyboardEvent<T = Element> = import("react").KeyboardEvent<T>;
    }
  }
}

declare module "react-dom/client" {
  import type { ReactNode } from "react";
  export function createRoot(container: Element): { render(node: ReactNode): void };
}

declare module "react/jsx-runtime" {
  import type { ReactElement } from "react";
  export function jsx(type: unknown, props: unknown, key?: unknown): ReactElement;
  export function jsxs(type: unknown, props: unknown, key?: unknown): ReactElement;
  export const Fragment: unique symbol;
}

declare namespace JSX {
  type Element = import("react").ReactElement;
  interface ElementChildrenAttribute {
    children: unknown;
  }
  interface IntrinsicAttributes {
    key?: string | number | null;
  }
  interface IntrinsicElements {
    [elem: string]: import("react").HTMLProps;
  }
}

// JSON modules (dictionaries) — mirrors resolveJsonModule behavior.
declare module "*.json" {
  const value: Record<string, unknown>;
  export default value;
}

// CSS side-effect imports (bundler concern, not a type concern).
declare module "*.css";
