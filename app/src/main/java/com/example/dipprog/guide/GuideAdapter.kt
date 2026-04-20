package com.example.dipprog.guide

import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.TextView
import androidx.recyclerview.widget.RecyclerView
import com.example.dipprog.R
import java.util.Locale

class GuideAdapter(
    sections: List<GuideSection>,
    private val onVisibleCountChanged: (Int) -> Unit = {},
) : RecyclerView.Adapter<GuideAdapter.VH>() {

    private var allSections: List<GuideSection> = sections
    private var visibleSections: List<GuideSection> = allSections

    class VH(view: View) : RecyclerView.ViewHolder(view) {
        val title: TextView = view.findViewById(R.id.guideSectionTitle)
        val body: TextView = view.findViewById(R.id.guideSectionBody)
    }

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): VH {
        val v = LayoutInflater.from(parent.context).inflate(R.layout.item_guide_section, parent, false)
        return VH(v)
    }

    override fun onBindViewHolder(holder: VH, position: Int) {
        val s = visibleSections[position]
        holder.title.text = s.title
        holder.body.text = s.body.trim()
    }

    override fun getItemCount(): Int = visibleSections.size

    fun setFilter(query: String) {
        val q = query.trim().lowercase(Locale.getDefault())
        visibleSections = if (q.isEmpty()) {
            allSections
        } else {
            allSections.filter { section ->
                section.title.lowercase(Locale.getDefault()).contains(q) ||
                    section.body.lowercase(Locale.getDefault()).contains(q)
            }
        }
        notifyDataSetChanged()
        onVisibleCountChanged(visibleSections.size)
    }

    fun setSections(sections: List<GuideSection>) {
        allSections = sections
        visibleSections = sections
        notifyDataSetChanged()
        onVisibleCountChanged(visibleSections.size)
    }
}
