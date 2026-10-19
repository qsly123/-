function textResponse(body: string, status: number) {
  return new Response(body, {
    status,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
    },
  });
}

export async function GET() {
  return textResponse("公益版本已关闭充值回调", 410);
}
