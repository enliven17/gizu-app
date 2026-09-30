package io.gizu.storedwallet

import java.io.IOException
import java.util.concurrent.TimeUnit
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import kotlinx.coroutines.suspendCancellableCoroutine
import okhttp3.*
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody

internal enum class RpcFailureCode {
  NETWORK,
  TIMEOUT,
  HTTP,
  RESPONSE_TOO_LARGE,
  RPC,
  INSUFFICIENT_FUNDS,
}

internal class RpcFailure(val code: RpcFailureCode) : Exception(code.name)

/** Private native transport. Endpoint injection is for JVM tests, never an Expo API. */
internal class NativeRpcTransport(
  private val endpoint: String = "https://testnet-rpc.monad.xyz",
  private val client: OkHttpClient =
    OkHttpClient.Builder()
      .followRedirects(false)
      .followSslRedirects(false)
      .retryOnConnectionFailure(false)
      .connectTimeout(8, TimeUnit.SECONDS)
      .readTimeout(20, TimeUnit.SECONDS)
      .writeTimeout(10, TimeUnit.SECONDS)
      .callTimeout(30, TimeUnit.SECONDS)
      .build(),
) {
  suspend fun post(payload: String): String = execute("POST", endpoint, payload).second

  suspend fun execute(method: String, url: String, body: String?): Pair<Int, String> =
    suspendCancellableCoroutine { continuation ->
      require(allowed(url) && (method == "GET" || method == "POST"))
      val request =
        Request.Builder()
          .url(url)
          .method(
            method,
            if (method == "GET") null
            else (body ?: "").toRequestBody("application/json".toMediaType()),
          )
          .build()
      val call = client.newCall(request)
      continuation.invokeOnCancellation { call.cancel() }
      call.enqueue(
        object : Callback {
          override fun onFailure(call: Call, e: IOException) {
            if (continuation.isActive)
              continuation.resumeWithException(
                RpcFailure(
                  if (e is java.io.InterruptedIOException) RpcFailureCode.TIMEOUT
                  else RpcFailureCode.NETWORK
                )
              )
          }

          override fun onResponse(call: Call, response: Response) {
            try {
              val result =
                response.use {
                  val payload = it.body ?: throw RpcFailure(RpcFailureCode.HTTP)
                  payload.byteStream().use { input ->
                    val output = java.io.ByteArrayOutputStream()
                    val buffer = ByteArray(8192)
                    while (true) {
                      val count = input.read(buffer)
                      if (count == -1) break
                      if (output.size() + count > 1_048_576)
                        throw RpcFailure(RpcFailureCode.RESPONSE_TOO_LARGE)
                      output.write(buffer, 0, count)
                    }
                    it.code to output.toString("UTF-8")
                  }
                }
              if (continuation.isActive) continuation.resume(result)
            } catch (failure: Exception) {
              val safe =
                failure as? RpcFailure
                  ?: RpcFailure(
                    if (failure is java.io.InterruptedIOException) RpcFailureCode.TIMEOUT
                    else RpcFailureCode.NETWORK
                  )
              if (continuation.isActive) continuation.resumeWithException(safe)
            }
          }
        }
      )
    }

  companion object {
    fun allowed(url: String): Boolean {
      val local =
        url.startsWith("http://127.0.0.1:") ||
          url.startsWith("http://localhost:") ||
          url.startsWith("http://10.0.2.2:")
      return (url.startsWith("https://") || local) &&
        !url.contains('?') &&
        !url.contains('#') &&
        url.length <= 300
    }
  }
}
