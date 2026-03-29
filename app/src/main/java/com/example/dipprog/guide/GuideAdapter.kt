package com.example.dipprog.guide

import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.TextView
import androidx.recyclerview.widget.RecyclerView
import com.example.dipprog.R

class GuideAdapter(private val sections: List<GuideSection>) : RecyclerView.Adapter<GuideAdapter.VH>() {

    class VH(view: View) : RecyclerView.ViewHolder(view) {
        val title: TextView = view.findViewById(R.id.guideSectionTitle)
        val body: TextView = view.findViewById(R.id.guideSectionBody)
    }

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): VH {
        val v = LayoutInflater.from(parent.context).inflate(R.layout.item_guide_section, parent, false)
        return VH(v)
    }

    override fun onBindViewHolder(holder: VH, position: Int) {
        val s = sections[position]
        holder.title.text = s.title
        holder.body.text = s.body.trim()
    }

    override fun getItemCount(): Int = sections.size
}
