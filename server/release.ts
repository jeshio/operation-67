/** Injected by the build; runtime environment cannot impersonate another release. */
declare const __RELEASE_COMMIT__: string;
declare const __RELEASE_DIRTY__: boolean;
export const release = Object.freeze({
  commit: typeof __RELEASE_COMMIT__ === 'string' ? __RELEASE_COMMIT__ : 'development',
  dirty: typeof __RELEASE_DIRTY__ === 'boolean' ? __RELEASE_DIRTY__ : true,
});
