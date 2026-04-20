package com.example.dipprog.guide

import android.content.res.ColorStateList
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.ImageView
import android.widget.TextView
import androidx.core.content.ContextCompat
import androidx.core.graphics.drawable.DrawableCompat
import androidx.recyclerview.widget.RecyclerView
import com.example.dipprog.R
import java.util.Locale

class GuideCategoryAdapter(
    categories: List<GuideCategory>,
    private val onCategoryClick: (GuideCategory) -> Unit,
    private val onVisibleCountChanged: (Int) -> Unit = {},
) : RecyclerView.Adapter<GuideCategoryAdapter.VH>() {

    private val allCategories: List<GuideCategory> = categories.toList()
    private var visibleCategories: List<GuideCategory> = allCategories

    class VH(view: View) : RecyclerView.ViewHolder(view) {
        val accentBar: View = view.findViewById(R.id.guideCategoryAccentBar)
        val iconBg: View = view.findViewById(R.id.guideCategoryIconBg)
        val icon: ImageView = view.findViewById(R.id.guideCategoryIcon)
        val title: TextView = view.findViewById(R.id.guideCategoryTitle)
        val subtitle: TextView = view.findViewById(R.id.guideCategorySubtitle)
    }

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): VH {
        val v = LayoutInflater.from(parent.context).inflate(R.layout.item_guide_category, parent, false)
        return VH(v)
    }

    override fun onBindViewHolder(holder: VH, position: Int) {
        val cat = visibleCategories[position]
        holder.title.text = cat.title
        holder.subtitle.text = cat.subtitle
        holder.icon.setImageResource(cat.iconRes)
        val ctx = holder.itemView.context
        holder.accentBar.setBackgroundColor(ContextCompat.getColor(ctx, cat.accentBarColorRes))
        ContextCompat.getDrawable(ctx, R.drawable.bg_guide_icon_circle)?.mutate()?.let { bg ->
            DrawableCompat.setTint(bg, ContextCompat.getColor(ctx, cat.iconCircleColorRes))
            holder.iconBg.background = bg
        }
        holder.icon.imageTintList = ColorStateList.valueOf(ContextCompat.getColor(ctx, cat.iconTintColorRes))
        holder.itemView.setOnClickListener { onCategoryClick(cat) }
    }

    override fun getItemCount(): Int = visibleCategories.size

    fun setFilter(query: String) {
        val q = query.trim().lowercase(Locale.getDefault())
        visibleCategories = if (q.isEmpty()) {
            allCategories
        } else {
            allCategories.filter { cat ->
                cat.title.lowercase(Locale.getDefault()).contains(q) ||
                    cat.subtitle.lowercase(Locale.getDefault()).contains(q) ||
                    cat.sections.any { section ->
                        section.title.lowercase(Locale.getDefault()).contains(q) ||
                            section.body.lowercase(Locale.getDefault()).contains(q)
                    }
            }
        }
        notifyDataSetChanged()
        onVisibleCountChanged(visibleCategories.size)
    }
}
