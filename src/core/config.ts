export const CLIENT_ID: string = import.meta.env.VITE_GOOGLE_CLIENT_ID ?? ''
/** Build-time flag: hides every create, edit, delete and upload action. */
export const READ_ONLY: boolean = import.meta.env.VITE_READ_ONLY === 'true'
/** Dev-only in-memory Drive (`npm run dev:fake`). Always false in production builds. */
export const FAKE_DRIVE: boolean = import.meta.env.DEV && import.meta.env.VITE_FAKE_DRIVE === 'true'
