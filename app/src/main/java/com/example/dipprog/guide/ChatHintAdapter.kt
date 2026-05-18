package com.example.dipprog.guide

import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.TextView
import androidx.recyclerview.widget.RecyclerView
import com.example.dipprog.R

class ChatHintAdapter(
    private var hints: List<String>,
    private val onHintClick: (String) -> Unit,
) : RecyclerView.Adapter<ChatHintAdapter.VH>() {

    class VH(v: View) : RecyclerView.ViewHolder(v) {
        val text: TextView = v.findViewById(R.id.chatHintText)
    }

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): VH {
        val v = LayoutInflater.from(parent.context).inflate(R.layout.item_chat_hint, parent, false)
        return VH(v)
    }

    override fun getItemCount(): Int = hints.size

    override fun onBindViewHolder(holder: VH, position: Int) {
        val hint = hints[position]
        holder.text.text = hint
        holder.itemView.setOnClickListener { onHintClick(hint) }
    }

    fun setHints(newHints: List<String>) {
        hints = newHints
        notifyDataSetChanged()
    }
}
