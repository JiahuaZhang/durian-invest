
# User Preferences and Coding Rules

## General Principles
1.  **Simplicity First**: Avoid over-engineering. Remove necessary state and keep React components lean.
2.  **Stateless Logic**: If a helper function (formatting, utils, etc.) does not rely on component props or state, move it **outside** the component definition.
3.  **Minimal Configuration**: Stick to library defaults whenever possible. Do not provide explicit configuration options (e.g., chart colors, grids, layouts) unless they differ significantly from the default or are strictly necessary for functionality. Avoid "boilerplate" config.

## React Patterns
-   **React Compiler**: This project uses React Compiler (`babel-plugin-react-compiler`). Do **not** use manual memoization hooks like `useMemo`, `useCallback`, or `React.memo`. Write simple, idiomatic React code and let the compiler handle optimizations.
-   **State Management**: Minimize `useState`. Consolidate related data into single objects (e.g., `Legend` object) rather than multiple atomic states.
-   **Refs vs Vars**: Inside `useEffect`, if a variable like a lookup Map doesn't need to persist across renders or be accessed by other effects, just define it as a local `const` or `let` instead of `useRef`.

## TypeScript
-   **Types vs Interfaces**: Prefer `type` alias over `interface`.

## Styling (UnoCSS)
-   **Library**: Use `unocss` exclusively. Avoid `tailwind` classes or inline `style` props where possible.
-   **Attributify Mode**: Use the attributify preset (e.g., `un-text="red"`).
-   **Correctiness**: There's no `un-font="medium"`.
-   **Grouping**: Group related utilities in a single attribute value.
    -   *Good*: `un-position="absolute top-2 left-2"`
    -   *Bad*: `un-position="absolute" un-top="2" un-left="2"`
    -   *Good*: `un-p="x-2 y-1"`
    -   *Bad*: `un-px="2" un-py="1"`
    -   *Good*: `un-border="~ purple-600 rounded-lg"`
    -   *Bad*: `un-rounded="lg" un-border="~" un-border-color="purple-600"`
-   **Avoid Tilda**: Prefer explicit values over boolean tildes.
    -   *Good*: `un-font="semibold"`
    -   *Bad*: `un-font-semibold="~"`

## TanStack Start
-   **Server Functions**: When a helper function (like data fetching) is called inside a `loader` or requires HTTP API requests, use `createServerFn` from `@tanstack/react-start`.
    -   *Why*: This ensures the code runs on the server, avoiding CORS issues and leveraging server-side capabilities.
    -   *Pattern*:
        ```typescript
        import { createServerFn } from '@tanstack/react-start';
        export const myServerFn = createServerFn({ method: "GET" })
        .inputValidator((d: MyType) => d)
        .handler(async ({ data }) => { ... })
        ```