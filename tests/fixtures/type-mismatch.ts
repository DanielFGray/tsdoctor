interface Expected {
  name: string
  age: number
  address: {
    street: string
    city: string
  }
}

interface Actual {
  name: string
  age: string // wrong: string vs number
  address: {
    street: number // wrong: number vs string
    city: string
  }
}

const x: Expected = {} as Actual
