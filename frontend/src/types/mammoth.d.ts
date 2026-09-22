declare module 'mammoth/mammoth.browser.min.js' {
  interface ConvertToHtmlInput {
    arrayBuffer: ArrayBuffer
  }
  interface ConvertToHtmlResult {
    value: string
    messages: unknown[]
  }
  const mammoth: {
    convertToHtml(input: ConvertToHtmlInput): Promise<ConvertToHtmlResult>
  }
  export default mammoth
}
