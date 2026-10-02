package io.gizu.storedwallet.swap

import java.math.BigInteger
import org.json.JSONArray
import org.json.JSONObject

/** Every child's native state is retained across progress, pauses and cancellation. */
internal class SwapFundingBatch private constructor(val json: JSONObject) {
  val currentIndex: Int
    get() = json.getInt("currentIndex")

  val current: JSONObject
    get() = json.getJSONArray("children").getJSONObject(currentIndex)

  val size: Int
    get() = json.getJSONArray("children").length()

  val id: String
    get() = json.getString("fundingBatchId")

  val cancelled: Boolean
    get() = json.getBoolean("cancelled")

  val budgetAtoms: String
    get() =
      (0 until size)
        .fold(BigInteger.ZERO) { sum, index ->
          sum +
            json
              .getJSONArray("children")
              .getJSONObject(index)
              .optString("budgetAtoms", "0")
              .toBigInteger()
        }
        .toString()

  fun record(state: String, status: String) {
    check(state.length <= 900_000)
    val view = JSONObject(status)
    check(
      !view.has("operationId") || view.getString("operationId") == current.getString("operationId")
    )
    current.put("state", state).put("status", status)
  }

  /** Caller persists the completed child before switching, then persists the new cursor. */
  fun advanceIfComplete(): Boolean {
    if (
      cancelled ||
        JSONObject(current.getString("status")).getString("phase") != "COMPLETE" ||
        currentIndex + 1 >= size
    )
      return false
    json.put("currentIndex", currentIndex + 1)
    return true
  }

  fun cancel() {
    json.put("cancelled", true)
  }

  fun publicStatus(status: JSONObject): JSONObject {
    val result = JSONObject(status.toString())
    val children = json.getJSONArray("children")
    fun total(field: String): String =
      (0 until children.length())
        .fold(BigInteger.ZERO) { sum, index ->
          val item = JSONObject(children.getJSONObject(index).getString("status"))
          val value = item.optString(field, "0").takeIf { it.matches(Regex("[0-9]+")) } ?: "0"
          sum + BigInteger(value)
        }
        .toString()
    for (field in listOf("sourceAtoms", "creditedAtoms", "receivedTargetAtoms")) result.put(
      field,
      total(field),
    )
    result.put("operationId", id)
    if (cancelled) result.put("phase", "CANCELLED")
    else if (result.getString("phase") == "COMPLETE" && currentIndex + 1 < size)
      result.put("phase", "FUNDING").put("step", "nextSourceReview")
    return result
  }

  companion object {
    fun archive(previous: JSONObject?, operationId: String): JSONArray {
      val history =
        previous?.optJSONArray("history")?.let { JSONArray(it.toString()) } ?: JSONArray()
      if (previous != null && previous.getString("operationId") != operationId) {
        val entry = JSONObject(previous.toString())
        entry.remove("history")
        history.put(entry)
      }
      return history
    }

    fun create(allocation: JSONObject, children: JSONArray): SwapFundingBatch {
      check(allocation.getInt("fundingBatchSize") == children.length())
      return restore(
        JSONObject()
          .put("version", 1)
          .put("fundingBatchId", allocation.getString("fundingBatchId"))
          .put("children", children)
          .put("currentIndex", 0)
          .put("cancelled", false)
      )
    }

    fun restore(json: JSONObject): SwapFundingBatch {
      check(json.getInt("version") == 1)
      check(json.getString("fundingBatchId").matches(Regex("[A-Za-z0-9_-]{1,128}")))
      val children = json.getJSONArray("children")
      check(children.length() in 1..256 && json.getInt("currentIndex") in 0 until children.length())
      val ids = mutableSetOf<String>()
      val indices = mutableSetOf<Int>()
      for (index in 0 until children.length()) {
        val child = children.getJSONObject(index)
        check(ids.add(child.getString("operationId")))
        val source = child.getInt("sourceIndex")
        check(source >= 0 && source != 2 && indices.add(source))
        check(child.getString("state").length <= 900_000)
        if (index < json.getInt("currentIndex"))
          check(JSONObject(child.getString("status")).getString("phase") == "COMPLETE")
      }
      return SwapFundingBatch(json)
    }
  }
}
