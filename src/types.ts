export interface SliderConfig {
  min: number
  max: number
  visible: boolean
}

export interface CellData {
  id: string
  input: string
  output: string | null
  error: string | null
  graphEnabled: boolean
  graphVisible: boolean
  color: string
  slider?: SliderConfig
}

export interface TabData {
  id: string
  label: string
  cells: CellData[]
}
