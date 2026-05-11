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

class DocumentsAdapter(
    private var items: List<DocumentsApi.Document>,
    private val onOpen: (DocumentsApi.Document) -> Unit,
    private val onDelete: (DocumentsApi.Document) -> Unit,
) : RecyclerView.Adapter<DocumentsAdapter.VH>() {

    class VH(v: View) : RecyclerView.ViewHolder(v) {
        val title: TextView = v.findViewById(R.id.itemDocTitle)
        val subtitle: TextView = v.findViewById(R.id.itemDocSubtitle)
        val openBtn: MaterialButton = v.findViewById(R.id.itemDocOpenBtn)
        val deleteBtn: MaterialButton = v.findViewById(R.id.itemDocDeleteBtn)
    }

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): VH =
        VH(LayoutInflater.from(parent.context).inflate(R.layout.item_document, parent, false))

    override fun onBindViewHolder(holder: VH, position: Int) {
        val d = items[position]
        holder.title.text = d.title
        val date = formatCreatedAt(d.created_at)
        val orderLabel = d.order_id?.let { "Заказ #$it · " } ?: ""
        holder.subtitle.text = "$orderLabel$date · ${d.file_name}"
        holder.itemView.setOnClickListener { onOpen(d) }
        holder.openBtn.setOnClickListener { onOpen(d) }
        holder.deleteBtn.setOnClickListener { onDelete(d) }
    }

    override fun getItemCount(): Int = items.size

    fun setData(list: List<DocumentsApi.Document>) {
        items = list
        notifyDataSetChanged()
    }

    private fun formatCreatedAt(raw: String?): String {
        if (raw.isNullOrBlank()) return "—"
        return try {
            val parsers = arrayOf(
                SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US),
                SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", Locale.US),
            )
            for (p in parsers) p.timeZone = TimeZone.getTimeZone("UTC")
            val out = SimpleDateFormat("dd.MM.yyyy HH:mm", Locale("ru", "RU"))
            var date: java.util.Date? = null
            for (p in parsers) {
                try {
                    date = p.parse(raw)
                    if (date != null) break
                } catch (_: Exception) {}
            }
            if (date != null) out.format(date) else raw.take(16)
        } catch (_: Exception) {
            raw.take(16)
        }
    }
}
