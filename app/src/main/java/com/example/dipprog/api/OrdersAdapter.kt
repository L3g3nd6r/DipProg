package com.example.dipprog.api

import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.TextView
import androidx.recyclerview.widget.RecyclerView
import com.example.dipprog.R
import com.google.android.material.button.MaterialButton
import java.text.SimpleDateFormat
import java.util.Locale
import java.util.TimeZone

class OrdersAdapter(
    private var items: List<BuildsApi.Order>,
    private val isAssemblerProvider: () -> Boolean,
    private val onComplete: (BuildsApi.Order) -> Unit,
    private val onConfirmReceipt: (BuildsApi.Order) -> Unit,
    private val onOpenDetail: (BuildsApi.Order) -> Unit
) : RecyclerView.Adapter<OrdersAdapter.VH>() {

    class VH(view: View) : RecyclerView.ViewHolder(view) {
        val title: TextView = view.findViewById(R.id.orderTitle)
        val subtitle: TextView = view.findViewById(R.id.orderSubtitle)
        val details: TextView = view.findViewById(R.id.orderDetails)
        val status: TextView = view.findViewById(R.id.orderStatus)
        val completeBtn: MaterialButton = view.findViewById(R.id.orderCompleteButton)
        val confirmBtn: MaterialButton = view.findViewById(R.id.orderConfirmReceiptButton)
    }

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): VH {
        val v = LayoutInflater.from(parent.context).inflate(R.layout.item_order, parent, false)
        return VH(v)
    }

    override fun getItemCount(): Int = items.size

    override fun onBindViewHolder(holder: VH, position: Int) {
        val item = items[position]
        val date = formatDate(item.created_at)
        holder.title.text = holder.itemView.context.getString(
            R.string.order_item_title,
            item.id,
            priceStr(item.total_rub)
        )
        holder.subtitle.text = "${item.customer_name} • ${item.customer_phone} • $date"
        holder.details.text = "${item.shipping_address}${if (!item.comment.isNullOrBlank()) "\nКомментарий: ${item.comment}" else ""}"

        val isAsm = isAssemblerProvider()
        val st = item.status?.lowercase(Locale.ROOT) ?: ""
        val isNew = st == "new"
        val isSent = st == "sent"
        val isReceived = st == "received"

        holder.status.text = when {
            isReceived -> {
                val whenStr = formatDate(item.received_at)
                holder.itemView.context.getString(R.string.order_status_received, whenStr)
            }
            isSent ->
                if (isAsm) holder.itemView.context.getString(R.string.order_status_sent_assembler)
                else holder.itemView.context.getString(R.string.order_status_sent_customer)
            isNew ->
                if (isAsm) holder.itemView.context.getString(R.string.order_status_new_assembler)
                else holder.itemView.context.getString(R.string.order_status_new_customer)
            else -> holder.itemView.context.getString(R.string.order_status_unknown, st)
        }

        holder.completeBtn.visibility = if (isAsm && isNew) View.VISIBLE else View.GONE
        holder.confirmBtn.visibility = if (!isAsm && isSent) View.VISIBLE else View.GONE
        holder.completeBtn.setOnClickListener { onComplete(item) }
        holder.confirmBtn.setOnClickListener { onConfirmReceipt(item) }

        holder.itemView.contentDescription = holder.itemView.context.getString(R.string.order_card_cd, item.id)
        holder.itemView.setOnClickListener { onOpenDetail(item) }
    }

    fun setData(newItems: List<BuildsApi.Order>) {
        items = newItems
        notifyDataSetChanged()
    }

    private fun priceStr(total: Number?): String {
        val n = total?.toDouble() ?: 0.0
        return String.format(Locale("ru", "RU"), "%,.0f ₽", n).replace(',', ' ')
    }

    private fun formatDate(value: String?): String {
        if (value.isNullOrBlank()) return "—"
        return try {
            val parser = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US).apply {
                timeZone = TimeZone.getTimeZone("UTC")
            }
            val fallback = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", Locale.US).apply {
                timeZone = TimeZone.getTimeZone("UTC")
            }
            val out = SimpleDateFormat("dd.MM.yyyy HH:mm", Locale("ru", "RU"))
            val d = parser.parse(value) ?: fallback.parse(value)
            if (d != null) out.format(d) else value.take(16)
        } catch (_: Exception) {
            value.take(16)
        }
    }
}
