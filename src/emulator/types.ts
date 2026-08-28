export type EmulatorStatus = 'idle' | 'loading' | 'ready' | 'running' | 'paused' | 'error'
export type EmulatorSpeed = 1 | 2 | 5

export type GbaButton =
  | 'up' | 'down' | 'left' | 'right'
  | 'a' | 'b' | 'l' | 'r' | 'start' | 'select'

export type CheatRule = {
  id: string
  name?: string
  code: string
  enabled: boolean
  builtIn?: boolean
}

export type SaveStateSlot = {
  gameId: string
  slot: number
  updatedAt: number
  thumbnail: string
}
